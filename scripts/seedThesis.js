const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const connectDB = require('../db/connection');
const Thesis = require('../models/Thesis');

const seedTheses = async () => {
    try {
        await connectDB();

        const jsonPath = path.join(__dirname, '..', '..', 'web', 'data', 'search_index.json');
        if (!fs.existsSync(jsonPath)) {
            console.error(`❌ JSON data not found at: ${jsonPath}`);
            process.exit(1);
        }

        const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const theses = Array.isArray(rawData) ? rawData : (rawData.theses || []);

        console.log(`📂 Loaded ${theses.length} theses from JSON.`);

        const extractAuthors = (abstract) => {
            if (!abstract) return 'Academic Research Group';
            const match = abstract.match(/(?:Researcher|Author|By|Researchers):\s*([^.]+)/i);
            return match ? match[1].trim() : 'Academic Research Group';
        };

        const processedData = theses.map(t => ({
            id: t.id,
            title: t.title,
            abstract: t.abstract,
            author: extractAuthors(t.abstract),
            year_range: t.year_range || 'unknown',
            filename: t.filename,
            source: t.source || 'ocr',
            word_count: t.word_count || 0
        }));

        console.log(`🚀 Starting upsert of ${processedData.length} records...`);

        // Use bulkWrite for efficiency
        const operations = processedData.map(doc => ({
            updateOne: {
                filter: { id: doc.id },
                update: { $set: doc },
                upsert: true
            }
        }));

        const result = await Thesis.bulkWrite(operations);

        console.log(`✅ Seeding Complete!`);
        console.log(`📝 Matched: ${result.matchedCount}`);
        console.log(`✨ Upserted: ${result.upsertedCount}`);
        console.log(`🔄 Modified: ${result.modifiedCount}`);

        await mongoose.connection.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Seeding failed:', error);
        process.exit(1);
    }
};

seedTheses();
