// Polyfills for pdf-parse in Node.js
if (typeof global.DOMMatrix === 'undefined') {
    global.DOMMatrix = class DOMMatrix { };
}
if (typeof global.Path2D === 'undefined') {
    global.Path2D = class Path2D { };
}

const pdf = require('pdf-parse');
const mammoth = require('mammoth');

/**
 * Extracts text from a buffer based on the mimetype, keeping track of pages
 */
async function extractText(buffer, mimetype) {
    if (mimetype === 'application/pdf') {
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
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const result = await mammoth.extractRawText({ buffer });
        return [{ pageNumber: 1, text: result.value }];
    } else if (mimetype === 'text/plain') {
        return [{ pageNumber: 1, text: buffer.toString('utf8') }];
    }
    throw new Error('Unsupported file type');
}

/**
 * Analyzes the text for academic quality
 */
async function analyzeDocument(buffer, mimetype) {
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
                pages: [1]
            });
        } else {
            lengthScore = 20;
            recommendations.push({
                category: 'Structure',
                title: 'Critical Content Deficit',
                description: 'The text is extremely brief.',
                suggestion: 'This entry does not appear to be a full academic research paper.',
                severity: 'high',
                pages: [1]
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
                    pages: []
                });
            }
        });

        const structureScore = (foundSections / academicSections.length) * 100;
        totalWeightedScore += structureScore * 0.4;
        scoreCount += 0.4;

        const overallScore = Math.max(0, Math.min(100, Math.round(totalWeightedScore / scoreCount)));

        return {
            overallScore,
            totalIssues: recommendations.length,
            statistics: {
                wordCount,
                sentenceCount,
                paragraphCount,
                readabilityIndex: Math.round(overallFleschKincaid)
            },
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
