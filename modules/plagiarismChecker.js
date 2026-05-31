/**
 * Plagiarism Checker Module
 * 
 * Hybrid plagiarism detection system:
 * - Layer 1: Local corpus similarity using:
 *            1. Shingling + Jaccard coefficient (for exact sequence match)
 *            2. TF-IDF Vectorizer + Cosine Similarity (for word frequency overlap - Node.js version of scikit-learn)
 *            3. Sentence Transformers Semantic Search (for semantic synonym matching - Node.js version of SentenceTransformer)
 * - Layer 2: External web plagiarism detection using DuckDuckGo (free, no API key required)
 */

const crypto = require('crypto');

// Global cache for Xenova SentenceTransformer pipeline
let pipelineInstance = null;

/**
 * Loads the local SentenceTransformer embedding pipeline on demand.
 * Uses Xenova/all-MiniLM-L6-v2, which is small (~90MB) and extremely fast on CPU.
 */
async function getEmbeddingPipeline() {
    if (!pipelineInstance) {
        try {
            const { pipeline } = await import('@xenova/transformers');
            pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        } catch (err) {
            console.error('Failed to load @xenova/transformers library:', err.message);
        }
    }
    return pipelineInstance;
}

/**
 * Generates a dense embedding vector for a sentence or text block using SentenceTransformer.
 * 
 * @param {string} text - Input text to embed
 * @returns {Promise<number[] | null>} 384-dimensional dense vector or null
 */
async function getSentenceEmbedding(text) {
    const pipeline = await getEmbeddingPipeline();
    if (!pipeline) return null;

    try {
        // Clean text and limit size to avoid transformer sequence length overflow (max 512 tokens)
        const cleanText = text.substring(0, 1000).replace(/\s+/g, ' ').trim();
        if (!cleanText) return null;

        const output = await pipeline(cleanText, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    } catch (err) {
        console.error('Error generating sentence embedding:', err.message);
        return null;
    }
}

// ============================================================
// TF-IDF VECTORIZER & COSINE SIMILARITY (JS Scikit-Learn Port)
// ============================================================

class TfidfVectorizer {
    constructor() {
        this.vocabulary = new Map(); // word -> index
        this.idf = [];               // index -> idf value
        this.documentsCount = 0;
        this.documentFrequencies = new Map(); // word -> doc count
    }

    _tokenize(text) {
        return text.toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2); // Ignore short words / numbers
    }

    fit(corpus) {
        this.documentsCount = corpus.length;
        this.vocabulary.clear();
        this.documentFrequencies.clear();

        // 1. Build document frequency counts
        corpus.forEach(doc => {
            const tokens = this._tokenize(doc);
            const uniqueTokens = new Set(tokens);
            uniqueTokens.forEach(token => {
                this.documentFrequencies.set(token, (this.documentFrequencies.get(token) || 0) + 1);
            });
        });

        // 2. Build vocabulary index & compute smooth IDF: log(N / (df + 1)) + 1
        let idx = 0;
        this.documentFrequencies.forEach((df, token) => {
            this.vocabulary.set(token, idx);
            const idfValue = Math.log(this.documentsCount / (df + 1)) + 1;
            this.idf.push(idfValue);
            idx++;
        });
    }

    transform(doc) {
        const tokens = this._tokenize(doc);
        const tf = new Map();
        tokens.forEach(token => {
            if (this.vocabulary.has(token)) {
                tf.set(token, (tf.get(token) || 0) + 1);
            }
        });

        const vector = new Array(this.vocabulary.size).fill(0);
        tf.forEach((count, token) => {
            const idx = this.vocabulary.get(token);
            // Normalized TF
            vector[idx] = count * this.idf[idx];
        });

        return vector;
    }
}

/**
 * Computes Cosine Similarity between two dense vectors.
 * Cos(A, B) = (A • B) / (||A|| * ||B||)
 * 
 * @param {number[]} vecA 
 * @param {number[]} vecB 
 * @returns {number} Cosine similarity score (0 to 1)
 */
function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}


// ============================================================
// LAYER 1: LOCAL CORPUS SIMILARITY (Jaccard + TF-IDF + Embeddings)
// ============================================================

/**
 * Normalizes text for consistent comparison:
 * lowercase, remove punctuation, collapse whitespace
 */
function normalizeText(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Creates word-level k-shingles from text.
 * A shingle is a contiguous sequence of k words.
 * 
 * @param {string} text - The input text
 * @param {number} k - Shingle size (default 3 words)
 * @returns {Set<string>} Set of unique shingles
 */
function createShingles(text, k = 3) {
    const normalized = normalizeText(text);
    const words = normalized.split(' ').filter(w => w.length > 0);
    const shingles = new Set();

    if (words.length < k) {
        shingles.add(words.join(' '));
        return shingles;
    }

    for (let i = 0; i <= words.length - k; i++) {
        const shingle = words.slice(i, i + k).join(' ');
        shingles.add(shingle);
    }

    return shingles;
}

/**
 * Computes Jaccard similarity between two sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 */
function jaccardSimilarity(setA, setB) {
    if (setA.size === 0 && setB.size === 0) return 0;
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    const smaller = setA.size <= setB.size ? setA : setB;
    const larger = setA.size <= setB.size ? setB : setA;

    for (const item of smaller) {
        if (larger.has(item)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Computes containment similarity (how much of A is contained in B).
 * C(A,B) = |A ∩ B| / |A|
 */
function containmentSimilarity(setA, setB) {
    if (setA.size === 0) return 0;

    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }

    return intersection / setA.size;
}

/**
 * Checks a document's text against all theses in the local database.
 * Computes Lexical Similarity (TF-IDF Cosine & Jaccard Shingling)
 * and reranks the top matches using local SentenceTransformers Semantic Search.
 * 
 * @param {string} documentText - Full text of the uploaded document
 * @param {Array} allTheses - Array of thesis objects with { id, title, abstract }
 * @returns {Promise<Object>} Local similarity results
 */
async function checkLocalSimilarity(documentText, allTheses) {
    if (!documentText || documentText.trim().length === 0 || allTheses.length === 0) {
        return { percentage: 0, topMatches: [], method: 'hybrid-tfidf-semantic' };
    }

    // 1. TF-IDF VECTORIZER FIT & TRANSFORM
    const corpus = allTheses.map(t => [t.title || '', t.abstract || ''].join(' '));
    corpus.push(documentText); // Add query to corpus for vocabulary building

    const vectorizer = new TfidfVectorizer();
    vectorizer.fit(corpus);

    const docTfidfVector = vectorizer.transform(documentText);
    const docShingles = createShingles(documentText, 3);

    const initialMatches = [];

    // 2. RETRIEVE CANDIDATES USING LEXICAL METRICS (TF-IDF & Shingling)
    for (let i = 0; i < allTheses.length; i++) {
        const thesis = allTheses[i];
        const thesisText = corpus[i];

        if (thesisText.trim().length < 20) continue;

        // TF-IDF Cosine Similarity
        const thesisVector = vectorizer.transform(thesisText);
        const tfidfScore = cosineSimilarity(docTfidfVector, thesisVector);

        // Jaccard & Containment Shingling
        const thesisShingles = createShingles(thesisText, 3);
        const jaccard = jaccardSimilarity(docShingles, thesisShingles);
        const containment = containmentSimilarity(docShingles, thesisShingles);
        const shingleScore = Math.max(jaccard, containment);

        // Combine lexical scores (take the best lexical representation)
        const lexicalScore = Math.max(tfidfScore, shingleScore);

        if (lexicalScore > 0.05) {
            initialMatches.push({
                thesisId: thesis.id,
                title: thesis.title,
                abstract: thesis.abstract || '',
                lexicalScore: lexicalScore,
                score: Math.round(lexicalScore * 100) // Initial score
            });
        }
    }

    // Sort by lexical score and take top 3 candidates for SentenceTransformer semantic reranking
    initialMatches.sort((a, b) => b.lexicalScore - a.lexicalScore);
    const topCandidates = initialMatches.slice(0, 3);

    if (topCandidates.length === 0) {
        return { percentage: 0, topMatches: [], method: 'hybrid-tfidf-semantic' };
    }

    // 3. SEMANTIC SEARCH RERANKING (SentenceTransformer all-MiniLM-L6-v2)
    const pipelineAvailable = await getEmbeddingPipeline();
    const finalMatches = [];

    if (pipelineAvailable) {
        // Embed the query document's abstract/intro (first 800 characters)
        const querySample = documentText.substring(0, 800);
        const queryEmbedding = await getSentenceEmbedding(querySample);

        if (queryEmbedding) {
            for (const candidate of topCandidates) {
                // Embed the thesis reference (title + abstract)
                const thesisSample = [candidate.title, candidate.abstract].join(' ').substring(0, 800);
                const candidateEmbedding = await getSentenceEmbedding(thesisSample);

                let combinedScore = candidate.lexicalScore;

                if (candidateEmbedding) {
                    const semanticSimilarity = cosineSimilarity(queryEmbedding, candidateEmbedding);
                    // Hybrid Score: 50% Lexical + 50% Semantic
                    combinedScore = (candidate.lexicalScore * 0.5) + (semanticSimilarity * 0.5);
                }

                finalMatches.push({
                    thesisId: candidate.thesisId,
                    title: candidate.title,
                    score: Math.min(100, Math.round(combinedScore * 100))
                });
            }
        }
    }

    // Fallback to lexical scores if SentenceTransformer fails
    if (finalMatches.length === 0) {
        topCandidates.forEach(c => {
            finalMatches.push({
                thesisId: c.thesisId,
                title: c.title,
                score: c.score
            });
        });
    }

    // Sort final matches by combined score
    finalMatches.sort((a, b) => b.score - a.score);

    return {
        percentage: finalMatches.length > 0 ? finalMatches[0].score : 0,
        topMatches: finalMatches,
        method: 'hybrid-tfidf-semantic'
    };
}


// ============================================================
// LAYER 2: WEB PLAGIARISM CHECK (DuckDuckGo — free, no API key)
// ============================================================

/**
 * Extracts representative sentences from text for web searching.
 * Picks the longest, most substantive sentences.
 */
function extractRepresentativeSentences(text, maxSentences = 8) {
    const rawSentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);

    const candidates = rawSentences.filter(s => {
        const words = s.split(/\s+/);
        if (words.length < 8) return false;
        if (words.length > 40) return false; 
        if (s === s.toUpperCase()) return false;
        if (/^\d+\s/.test(s)) return false; 
        return true;
    });

    const scored = candidates.map(s => {
        const words = s.split(/\s+/);
        const lengthScore = words.length >= 12 && words.length <= 25 ? 2 : 1;
        const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'this', 'that', 'it', 'with', 'as', 'by', 'from']);
        const specificWords = words.filter(w => !commonWords.has(w.toLowerCase())).length;
        const specificityScore = specificWords / words.length;

        return { sentence: s, score: lengthScore * specificityScore * words.length };
    });

    scored.sort((a, b) => b.score - a.score);

    const selected = [];
    const textLength = text.length;

    for (const item of scored) {
        if (selected.length >= maxSentences) break;

        const position = text.indexOf(item.sentence);
        const relativePosition = position / textLength;

        const tooClose = selected.some(s => {
            const sPos = text.indexOf(s) / textLength;
            return Math.abs(relativePosition - sPos) < 0.1;
        });

        if (!tooClose) {
            selected.push(item.sentence);
        }
    }

    if (selected.length < Math.min(maxSentences, scored.length)) {
        for (const item of scored) {
            if (selected.length >= maxSentences) break;
            if (!selected.includes(item.sentence)) {
                selected.push(item.sentence);
            }
        }
    }

    return selected;
}

/**
 * Searches the web using DuckDuckGo HTML search.
 */
async function searchDuckDuckGo(query) {
    try {
        const searchQuery = encodeURIComponent(`"${query.substring(0, 100)}"`);
        const url = `https://html.duckduckgo.com/html/?q=${searchQuery}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        if (!response.ok) {
            console.error(`DuckDuckGo search error: ${response.status}`);
            return [];
        }

        const html = await response.text();
        const results = [];
        const resultBlocks = html.split(/class="result\s/g).slice(1);

        for (const block of resultBlocks.slice(0, 5)) {
            const urlMatch = block.match(/href="([^"]+)"/);
            const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

            if (urlMatch && titleMatch) {
                let resultUrl = urlMatch[1];
                const actualUrlMatch = resultUrl.match(/uddg=([^&]+)/);
                if (actualUrlMatch) {
                    resultUrl = decodeURIComponent(actualUrlMatch[1]);
                }

                let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';

                results.push({
                    title: titleMatch[1].trim(),
                    url: resultUrl,
                    snippet: snippet
                });
            }
        }

        return results;
    } catch (err) {
        console.error('DuckDuckGo search error:', err.message);
        return [];
    }
}

/**
 * Computes text similarity between two strings using word overlap.
 */
function snippetSimilarity(text1, text2) {
    const normalize = t => t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const s1 = normalize(text1);
    const s2 = normalize(text2);

    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(s2.split(' ').filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let overlap = 0;
    for (const word of words1) {
        if (words2.has(word)) overlap++;
    }

    return overlap / words1.size;
}

/**
 * Performs web plagiarism check.
 */
async function checkWebPlagiarism(documentText) {
    const sentences = extractRepresentativeSentences(documentText, 8);

    if (sentences.length === 0) {
        return { percentage: 0, sourcesFound: 0, matches: [], sentencesChecked: 0 };
    }

    const allMatches = [];
    const uniqueSources = new Set();
    let totalSimilarity = 0;
    let checkedCount = 0;

    for (const sentence of sentences) {
        if (checkedCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 600)); // Rate limit check
        }

        const results = await searchDuckDuckGo(sentence);
        checkedCount++;

        for (const result of results) {
            const sim = snippetSimilarity(sentence, result.snippet);

            if (sim > 0.4) {
                uniqueSources.add(result.url);
                allMatches.push({
                    sentence: sentence.substring(0, 150) + (sentence.length > 150 ? '...' : ''),
                    matchedUrl: result.url,
                    matchedTitle: result.title,
                    snippet: result.snippet.substring(0, 200),
                    similarity: Math.round(sim * 100)
                });
            }
        }

        if (results.length > 0) {
            const bestMatch = results.reduce((best, r) => {
                const sim = snippetSimilarity(sentence, r.snippet);
                return sim > best ? sim : best;
            }, 0);
            totalSimilarity += bestMatch;
        }
    }

    allMatches.sort((a, b) => b.similarity - a.similarity);
    const avgSimilarity = checkedCount > 0 ? (totalSimilarity / checkedCount) * 100 : 0;

    return {
        percentage: Math.round(avgSimilarity),
        sourcesFound: uniqueSources.size,
        sentencesChecked: checkedCount,
        searchEngine: 'DuckDuckGo',
        matches: allMatches.slice(0, 10),
    };
}


// ============================================================
// COMBINED PLAGIARISM CHECK
// ============================================================

/**
 * Performs a full hybrid plagiarism check.
 * 
 * @param {string} documentText - Full text of the uploaded document
 * @param {Array} allTheses - Array of thesis objects from the database
 * @returns {Object} Complete plagiarism report
 */
async function performPlagiarismCheck(documentText, allTheses) {
    const startTime = Date.now();

    // Layer 1: Local corpus check (Lexical Jaccard/TF-IDF & Semantic Embeddings)
    const localResult = await checkLocalSimilarity(documentText, allTheses);

    // Layer 2: Web check (DuckDuckGo Search)
    const webResult = await checkWebPlagiarism(documentText);

    // Combined overall score: weighted average (40% Local + 60% Web)
    const overallScore = Math.round(
        (localResult.percentage * 0.4) + (webResult.percentage * 0.6)
    );

    let verdict;
    if (overallScore >= 50) {
        verdict = 'High Risk — Significant similarity detected';
    } else if (overallScore >= 30) {
        verdict = 'Medium Risk — Moderate similarity found';
    } else if (overallScore >= 15) {
        verdict = 'Low Risk — Minor similarities detected';
    } else {
        verdict = 'Minimal Risk — Content appears original';
    }

    const elapsed = Date.now() - startTime;

    return {
        overallScore,
        verdict,
        localSimilarity: localResult,
        webSimilarity: webResult,
        processingTimeMs: elapsed,
        timestamp: new Date().toISOString()
    };
}

module.exports = {
    performPlagiarismCheck,
    checkLocalSimilarity,
    checkWebPlagiarism,
    createShingles,
    jaccardSimilarity,
    containmentSimilarity,
    extractRepresentativeSentences,
    TfidfVectorizer,
    cosineSimilarity,
    getSentenceEmbedding
};
