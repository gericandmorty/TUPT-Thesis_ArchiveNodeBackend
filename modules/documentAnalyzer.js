// Polyfills for pdf-parse in Node.js
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix { };
}
if (typeof global.Path2D === 'undefined') {
    global.Path2D = class Path2D { };
}

const pdf = require('pdf-parse');
const mammoth = require('mammoth');
const nlp = require('compromise');
const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Extracts text from a buffer based on the mimetype, keeping track of pages
 */
async function extractText(buffer, mimetype) {
    // Magic number detection for robustness
    const signature = buffer.slice(0, 4).toString('hex');
    const isPDF = signature === '25504446'; // %PDF
    const isZip = signature.startsWith('504b'); // PK (Zip/Docx)

    let effectiveMimetype = mimetype;
    if (isPDF) {
        effectiveMimetype = 'application/pdf';
        console.log('--- SIGNATURE: PDF detected ---');
    } else if (isZip) {
        effectiveMimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        console.log('--- SIGNATURE: DOCX/Zip detected ---');
    }

    console.log(`Processing file with effective mimetype: ${effectiveMimetype} (Original: ${mimetype})`);

    if (effectiveMimetype === 'application/pdf') {
        const pages = [];
        let currentPage = 1;

        function render_page(pageData) {
            const render_options = { normalizeWhitespace: false, disableCombineTextItems: false };
            return pageData.getTextContent(render_options).then(function (textContent) {
                let lastY, text = '';
                for (let item of textContent.items) {
                    if (lastY == item.transform[5] || !lastY) {
                        text += item.str;
                    } else {
                        text += '\n' + item.str;
                    }
                    lastY = item.transform[5];
                }
                pages.push({ pageNumber: currentPage++, text: text });
                return text;
            });
        }

        await pdf(buffer, { pagerender: render_page });
        return pages;
    } else if (effectiveMimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        const fullText = result.value;

        // Split DOCX into "virtual pages" every ~300 words for better UI rendering (Academic Standard)
        const words = fullText.split(/(\s+)/);
        const pages = [];
        const wordsPerPage = 300;

        for (let i = 0; i < words.length; i += wordsPerPage * 2) {
            const pageText = words.slice(i, i + wordsPerPage * 2).join('');
            if (pageText.trim()) {
                pages.push({
                    pageNumber: Math.floor(i / (wordsPerPage * 2)) + 1,
                    text: pageText
                });
            }
        }
        return pages.length > 0 ? pages : [{ pageNumber: 1, text: fullText }];
    } else if (effectiveMimetype === 'text/plain') {
        return [{ pageNumber: 1, text: buffer.toString('utf8') }];
    }
    throw new Error('Unsupported file type');
}

/**
 * Analyzes the text for academic quality
 */
/**
 * Detects jumbled or nonsensical text using Rule-Based NLP (Compromise)
 */
function detectJumbledText(text) {
    const doc = nlp(text);
    const sentences = doc.sentences().json();
    const jumbledIssues = [];

    sentences.forEach(s => {
        const words = s.terms.map(t => t.text.toLowerCase());
        const tags = s.terms.flatMap(t => t.tags);

        // 1. Check for "Noun-Noun-Noun-Noun" (Likely jumbled list or nonsense)
        let nounCount = 0;
        let isJumbled = false;

        s.terms.forEach(t => {
            if (t.tags.includes('Noun')) nounCount++;
            else nounCount = 0;
            if (nounCount >= 4) isJumbled = true;
        });

        // 2. Check for missing verbs in long "sentences"
        const hasVerb = tags.includes('Verb') || tags.includes('Auxiliary');
        if (words.length > 6 && !hasVerb) isJumbled = true;

        // 3. Check for repetitive word sequences
        for (let i = 0; i < words.length - 2; i++) {
            if (words[i] === words[i + 1] && words[i + 1] === words[i + 2]) {
                isJumbled = true;
            }
        }

        if (isJumbled) {
            jumbledIssues.push({
                category: 'Grammar & Style',
                severity: 'high',
                title: 'Jumbled Content Detected',
                description: 'This sentence appears to be jumbled or nonsensical. Academic writing requires clear subject-verb structures.',
                suggestion: 'Rewrite this section to ensure a clear logical flow and proper academic sentence structure.',
                context: s.text,
                targetWord: words[0],
                suggestionType: 'review' // Indicates manual review/fix needed
            });
        }
    });

    return jumbledIssues;
}

async function analyzeDocument(buffer, mimetype) {
    console.log('--- Document Analyzer v2.1 Activated ---');
    try {
        const pages = await extractText(buffer, mimetype);
        const { default: readability } = await import('text-readability');

        const fullText = pages.map(p => p.text).join('\n\n');

        // Basic Statistics
        const wordCount = fullText.split(/\s+/).filter(w => w.length > 0).length;
        const sentenceCount = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
        const paragraphCount = fullText.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;

        // Overall Readability Score
        const overallFleschKincaid = readability.fleschKincaidGrade(fullText);

        const recommendations = [];
        let scoreCount = 0;
        let totalWeightedScore = 0;

        // --- Academic Assessment ---

        // 1. Length Assessment (Score Weight: 20)
        let lengthScore = 0;
        if (wordCount > 3000) {
            lengthScore = 100;
        } else if (wordCount > 1000) {
            lengthScore = 80;
        } else if (wordCount > 500) {
            lengthScore = 50;
            recommendations.push({
                category: 'Structure',
                title: 'Insufficient Content Length',
                description: 'The document is quite short for an academic paper.',
                suggestion: 'Typically, higher education research papers should be at least 1,500 words.',
                severity: 'medium',
                pages: [1],
                context: pages[0]?.text.split('\n')[0].substring(0, 100).trim()
            });
        } else {
            lengthScore = 20;
            recommendations.push({
                category: 'Structure',
                title: 'Critical Content Deficit',
                description: 'The text is extremely brief.',
                suggestion: 'This entry does not appear to be a full academic research paper.',
                severity: 'high',
                pages: [1],
                context: pages[0]?.text.split('\n')[0].substring(0, 100).trim()
            });
        }
        totalWeightedScore += lengthScore * 0.2;
        scoreCount += 0.2;

        // 2. Page-level Complexity and Tone (Score Weight: 40)
        let overlyComplexPages = [];
        let simplePages = [];
        let informalPages = [];

        const academicBuzzwords = ['significant', 'furthermore', 'nevertheless', 'empirical', 'methodology', 'consequently', 'theoretical', 'framework', 'hypothesis', 'analysis', 'investigation', 'comprehensive'];

        let pageComplexityScores = [];
        let pageToneScores = [];

        for (const page of pages) {
            const pageText = page.text;
            const pageWordCount = pageText.split(/\s+/).filter(w => w.length > 0).length;

            if (pageWordCount < 30) continue; // Skip title pages, empty pages, etc.

            const pageFleschKincaid = readability.fleschKincaidGrade(pageText);
            let complexityRating = 100;

            if (pageFleschKincaid > 20) {
                overlyComplexPages.push(page.pageNumber);
                complexityRating = 70;
            } else if (pageFleschKincaid < 10) {
                simplePages.push(page.pageNumber);
                complexityRating = 50;
            }
            pageComplexityScores.push(complexityRating);

            let buzzwordCount = 0;
            academicBuzzwords.forEach(word => {
                if (pageText.toLowerCase().includes(word)) buzzwordCount += 1;
            });

            // Adjust tone expectation based on word count
            const expectedBuzzwords = Math.max(1, Math.round(pageWordCount / 100));
            const toneRating = Math.min(100, (buzzwordCount / expectedBuzzwords) * 100);

            if (toneRating < 30) {
                informalPages.push(page.pageNumber);
            }
            pageToneScores.push(toneRating);
        }

        const avgComplexity = pageComplexityScores.length ? pageComplexityScores.reduce((a, b) => a + b, 0) / pageComplexityScores.length : 100;
        const avgTone = pageToneScores.length ? pageToneScores.reduce((a, b) => a + b, 0) / pageToneScores.length : 100;

        totalWeightedScore += avgComplexity * 0.2;
        scoreCount += 0.2;

        totalWeightedScore += avgTone * 0.2;
        scoreCount += 0.2;

        if (overlyComplexPages.length > 0) {
            recommendations.push({
                category: 'Writing Style',
                title: 'Extremely High Complexity',
                description: 'The language used on specific pages is exceptionally dense.',
                suggestion: 'Ensure the use of academic jargon does not obscure the core meaning of the research.',
                severity: 'medium',
                pages: overlyComplexPages
            });
        }
        if (simplePages.length > 0) {
            recommendations.push({
                category: 'Writing Style',
                title: 'Simple Language',
                description: 'Readability level on specific pages is below standard for college research.',
                suggestion: 'Consider using more advanced academic vocabulary and formal sentence structures.',
                severity: 'medium',
                pages: simplePages
            });
        }
        if (informalPages.length > 0) {
            recommendations.push({
                category: 'Academic Style',
                title: 'Informal Tone',
                description: 'Specific pages lack key transitional and academic markers.',
                suggestion: 'Incorporate academic signposts like "furthermore," "consequently," and "empirical evidence."',
                severity: 'medium',
                pages: informalPages
            });
        }

        // 3. Structural Markers (Score Weight: 40)
        const academicSections = [
            { name: 'Introduction', regex: /(^|\n)introduction/i },
            { name: 'Methodology', regex: /(^|\n)(methodology|materials and methods)/i },
            { name: 'Results', regex: /(^|\n)(results|findings)/i },
            { name: 'Conclusion', regex: /(^|\n)(conclusion|summary)/i },
            { name: 'References', regex: /(^|\n)(references|bibliography)/i }
        ];

        let foundSections = 0;
        academicSections.forEach(section => {
            const foundPage = pages.find(p => section.regex.test(p.text));
            if (foundPage) {
                foundSections++;
            } else {
                recommendations.push({
                    category: 'Structure',
                    title: `Missing ${section.name} Section`,
                    description: `Could not identify a clear '${section.name}' header.`,
                    suggestion: `Include a formal '${section.name}' section to align with institutional standards.`,
                    severity: section.name === 'References' || section.name === 'Methodology' ? 'high' : 'medium',
                    pages: [1],
                    context: pages[0]?.text.split('\n')[0].substring(0, 100).trim() // Highlight first line as context
                });
            }
        });

        const structureScore = (foundSections / academicSections.length) * 100;
        totalWeightedScore += structureScore * 0.4;
        scoreCount += 0.4;

        // 4. AI-Enhanced Writing Style & Vocabulary Audit
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        // We'll analyze chunks of text to get high-quality suggestions
        // To save tokens and time, we'll analyze the first 2000 words max for granular style
        const analysisSample = fullText.substring(0, 10000);

        const prompt = `
            Act as a professional academic editor specialized in university-level research papers.
            Analyze the following text for:
            1. Informal or weak word choices (e.g., "get", "bad", "stuff").
            2. Passive voice that should be active.
            3. Wordy or repetitive phrases.
            4. Tone issues (too casual).

            Return a JSON array of objects strictly in this format:
            [{
                "category": "Grammar & Style" | "Writing Style" | "Academic Style",
                "title": "Word Choice" | "Passive Voice" | "Wordiness" | "Tone",
                "description": "Short explanation",
                "suggestion": "Specific improvement suggestion",
                "suggestionType": "replacement",
                "targetWord": "EXACT word or phrase to replace (match CASE and SPELLING exactly)",
                "suggestedWord": "Corrected/Academic version",
                "context": "The UNIQUE sentence or phrase containing the error (Must match exactly)"
            }]

            IMPORTANT: The "context" MUST exist exactly as written in the source text.
            IMPORTANT: "targetWord" MUST be a single word or short phrase that exists WITHIN the "context".

            TEXT TO ANALYZE:
            "${analysisSample}"
        `;

        try {
            const aiResult = await model.generateContent(prompt);
            const aiResponse = aiResult.response.text();

            // Clean JSON string (Gemini sometimes adds markdown blocks)
            const cleanJson = aiResponse.replace(/```json|```/g, "").trim();
            const aiRecommendations = JSON.parse(cleanJson);

            // Add library-based jumbled text detection
            const fullSample = pages.map(p => p.text).join(' ');
            const nlpIssues = detectJumbledText(fullSample);
            const combinedRecommendations = [...nlpIssues, ...aiRecommendations];

            combinedRecommendations.forEach(rec => {
                // Generate a stable ID if not provided
                const id = rec.id || `${rec.title}-${rec.context}`.replace(/[^a-z0-9]/gi, '-').substring(0, 50);

                // Find which page this context belongs to
                const pageIndex = pages.findIndex(p => p.text.includes(rec.context));

                recommendations.push({
                    ...rec,
                    id,
                    severity: rec.severity || 'medium',
                    pages: pageIndex !== -1 ? [pageIndex + 1] : [1] // Fallback to page 1 if context tracking fails
                });
            });
            console.log(`--- Analysis Complete: Found ${combinedRecommendations.length} suggestions (NLP + AI) ---`);
        } catch (aiError) {
            console.error('AI Analysis failed, falling back to rule-based analysis:', aiError);

            // fallback logic (the previous dictionary logic)
            const academicSynonyms = {
                'good': 'exemplary', 'bad': 'suboptimal', 'big': 'substantial', 'small': 'minimal',
                'get': 'obtain', 'show': 'demonstrate', 'think': 'hypothesize', 'thing': 'element'
            };

            pages.forEach(page => {
                const sentences = page.text.match(/[^.!?]+[.!?]+/g) || [page.text];
                sentences.forEach(sentence => {
                    const trimmed = sentence.trim();
                    const words = trimmed.split(/\b/);
                    words.forEach(word => {
                        const lowerWord = word.toLowerCase();
                        if (academicSynonyms[lowerWord]) {
                            recommendations.push({
                                category: 'Writing Style',
                                title: 'Word Choice',
                                description: `Imprecise word: "${word}"`,
                                suggestion: `Use "${academicSynonyms[lowerWord]}" instead.`,
                                suggestionType: 'replacement',
                                targetWord: word,
                                suggestedWord: academicSynonyms[lowerWord],
                                severity: 'low',
                                pages: [page.pageNumber],
                                context: trimmed
                            });
                        }
                    });
                });
            });
        }

        // 5. Traditional Rule-Based Checks (Speed)
        const firstPersonRegex = /\b(I|me|my|mine|we|us|our|ours)\b/i;
        pages.forEach(page => {
            const sentences = page.text.match(/[^.!?]+[.!?]+/g) || [page.text];
            sentences.forEach(trimmed => {
                if (trimmed.length < 10) return;
                if (firstPersonRegex.test(trimmed)) {
                    recommendations.push({
                        category: 'Academic Style',
                        title: 'First-Person Usage',
                        description: 'First-person pronouns found.',
                        suggestion: 'Use third-person for objectivity (e.g., "This study", "The research").',
                        severity: 'low',
                        pages: [page.pageNumber],
                        context: trimmed,
                        suggestionType: 'review'
                    });
                }
            });
        });

        const overallScore = Math.max(0, Math.min(100, Math.round(totalWeightedScore / scoreCount)));

        // Organize findings into categories for the UI
        const categories = [
            { name: 'Structure', color: '#f59e0b', issues: recommendations.filter(r => r.category === 'Structure') },
            { name: 'Grammar & Style', color: '#ef4444', issues: recommendations.filter(r => r.category === 'Grammar & Style') },
            { name: 'Writing Style', color: '#3b82f6', issues: recommendations.filter(r => r.category === 'Writing Style') },
            { name: 'Academic Style', color: '#8b5cf6', issues: recommendations.filter(r => r.category === 'Academic Style') }
        ];

        return {
            overallScore,
            totalIssues: recommendations.length,
            statistics: {
                wordCount: wordCount || 0,
                sentenceCount: sentenceCount || 0,
                paragraphCount: paragraphCount || 0,
                readabilityIndex: Math.round(overallFleschKincaid) || 0
            },
            categories,
            recommendations,
            pagesText: pages
        };

    } catch (error) {
        console.error('Document analysis error:', error);
        throw error;
    }
}

module.exports = {
    analyzeDocument
};
