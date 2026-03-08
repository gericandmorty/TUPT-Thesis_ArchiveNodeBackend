const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../db/connection');
const Thesis = require('../models/Thesis');

const METADATA_DIR = path.join(__dirname, '..', '..', 'python', 'extracted_metadata');

const normalize = (str) => {
    if (!str) return '';
    return str.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
};

const isValidAuthor = (name) => {
    if (!name) return false;
    // Filter out obvious junk like "1HA0A", "Researcher", "Subject Coordinator", "CamScanner"
    const junk = ['researcher', 'subject coordinator', 'camscanner', 'beng', 'bsit', 'bsce', 'bsee', 'btau', 'btvted', 'sp bet'];
    const lower = name.toLowerCase();
    if (junk.some(j => lower.includes(j))) return false;
    if (name.length < 3) return false;
    if (!/[a-zA-Z]/.test(name)) return false; // Must have at least one letter
    return true;
};

const syncAuthors = async () => {
    try {
        await connectDB();

        if (!fs.existsSync(METADATA_DIR)) {
            console.error(`❌ Metadata directory not found: ${METADATA_DIR}`);
            process.exit(1);
        }

        const files = fs.readdirSync(METADATA_DIR).filter(f => f.endsWith('.json'));
        console.log(`📂 Found ${files.length} metadata files.`);

        const metadataMap = new Map();
        const abstractMap = new Map(); // New map for abstract-based matching
        let totalMetadataEntries = 0;

        files.forEach(file => {
            // Extract category from filename (e.g., "BSEE.json" -> "BSEE")
            let category = file.replace(/\.json$/i, '')
                .replace(/^(SP\s+)?(BET|BS|BT|B|SP)\s*([A-Z]+).*/i, '$2$3')
                .split(/[\s_-]/)[0]
                .toUpperCase();

            // Clean up common prefixes
            if (category.startsWith('SPBET')) category = 'BET';
            if (category.startsWith('SPBT')) category = 'BTTE';
            if (category === 'SP') category = 'BET';
            if (file.includes('BSIT')) category = 'BSIT';
            if (file.includes('BSEE')) category = 'BSEE';
            if (file.includes('BSME')) category = 'BSME';
            if (file.includes('BSCE')) category = 'BSCE';
            if (file.includes('BENG')) category = 'BENG';

            const raw = JSON.parse(fs.readFileSync(path.join(METADATA_DIR, file), 'utf8'));
            raw.forEach(entry => {
                totalMetadataEntries++;
                // Join valid authors
                const cleanAuthors = (entry.authors || [])
                    .filter(isValidAuthor)
                    .map(a => a.trim().replace(/\*$/, ''))
                    .join(', ');

                const titleKey = normalize(entry.title);
                const compositeKey = `${titleKey}_${normalize(entry.filename)}`;

                const metaData = {
                    author: cleanAuthors || null,
                    category: category
                };

                metadataMap.set(compositeKey, metaData);
                if (!metadataMap.has(titleKey)) {
                    metadataMap.set(titleKey, metaData);
                }

                // Store by abstract snippet (first 100 chars, normalized)
                if (entry.abstract) {
                    const abstractKey = normalize(entry.abstract.substring(0, 100));
                    if (abstractKey.length > 20) {
                        abstractMap.set(abstractKey, metaData);
                    }
                }
            });
        });

        console.log(`🧠 Map built with ${metadataMap.size} title keys and ${abstractMap.size} abstract keys from ${totalMetadataEntries} total entries.`);

        const allTheses = await Thesis.find({});
        console.log(`🔎 Found ${allTheses.length} records in MongoDB.`);

        let updatedCount = 0;
        let missedCount = 0;
        const operations = [];

        allTheses.forEach(thesis => {
            const compositeKey = `${normalize(thesis.title)}_${normalize(thesis.filename)}`;
            const titleKey = normalize(thesis.title);
            const abstractKey = thesis.abstract ? normalize(thesis.abstract.substring(0, 100)) : '';

            let match = metadataMap.get(compositeKey) || metadataMap.get(titleKey) || abstractMap.get(abstractKey);
            let correctAuthor = match ? match.author : null;
            let correctCategory = match ? match.category : (thesis.category || 'General');

            // If still no author match and title is a fallback title, try to extract from end of abstract
            if (!correctAuthor || correctAuthor === 'Academic Research Group') {
                if (thesis.abstract && thesis.abstract.length > 20) {
                    const lines = thesis.abstract.split('\n').filter(l => l.trim().length > 0);
                    const lastLine = lines[lines.length - 1] || '';
                    if (lastLine.length > 5 && lastLine.length < 100 && /[a-zA-Z]/.test(lastLine)) {
                        const cleanLast = lastLine.replace(/^(BACHELOR OF ENGINEERING|v|iv|iii|ii|i|page|\|)\s*/i, '').trim();
                        if (isValidAuthor(cleanLast)) {
                            correctAuthor = cleanLast;
                        }
                    }
                }
            }

            const updateFields = {};
            if (correctAuthor && correctAuthor !== 'Academic Research Group' && thesis.author !== correctAuthor) {
                updateFields.author = correctAuthor;
            }
            if (correctCategory && thesis.category !== correctCategory) {
                updateFields.category = correctCategory;
            }

            if (Object.keys(updateFields).length > 0) {
                operations.push({
                    updateOne: {
                        filter: { _id: thesis._id },
                        update: { $set: updateFields }
                    }
                });
                updatedCount++;
            } else {
                missedCount++;
            }
        });

        if (operations.length > 0) {
            console.log(`🚀 Updating ${operations.length} records in MongoDB...`);
            const result = await Thesis.bulkWrite(operations);
            console.log(`✅ Update complete!`);
            console.log(`📝 Modified: ${result.modifiedCount}`);
        } else {
            console.log(`⚠️ No updates to perform.`);
        }

        console.log(`📊 Summary: ${updatedCount} updated, ${missedCount} remained or skipped.`);

        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Sync failed:', error);
        process.exit(1);
    }
};

syncAuthors();
