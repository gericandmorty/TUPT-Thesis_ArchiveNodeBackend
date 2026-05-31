/**
 * Plagiarism Checker Module
 * 
 * Hybrid plagiarism detection system:
 * - Layer 1: Local corpus similarity using Shingling + Jaccard coefficient
 * - Layer 2: External web plagiarism detection using DuckDuckGo (free, no API key required)
 * 
 * References:
 * - Broder, A. Z. (1997). "On the resemblance and containment of documents"
 * - Rabin fingerprinting for shingle hashing
 */

const crypto = require('crypto');

// ============================================================
// LAYER 1: LOCAL CORPUS SIMILARITY (Shingling + Jaccard)
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
        // If text is shorter than k, use the whole text as one shingle
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
 * 
 * @param {Set} setA 
 * @param {Set} setB 
 * @returns {number} Similarity score between 0 and 1
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
 * This is better for detecting if a shorter text is copied from a longer one.
 * 
 * @param {Set} setA - The document being checked
 * @param {Set} setB - The reference document
 * @returns {number} Containment score between 0 and 1
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
 * Uses shingling + Jaccard/Containment for accurate similarity detection.
 * 
 * @param {string} documentText - Full text of the uploaded document
 * @param {Array} allTheses - Array of thesis objects with { id, title, abstract }
 * @returns {Object} Local similarity results
 */
function checkLocalSimilarity(documentText, allTheses) {
    if (!documentText || documentText.trim().length === 0) {
        return { percentage: 0, topMatches: [], method: 'shingling-jaccard' };
    }

    // Create shingles for the uploaded document (using k=3 for abstracts/shorter text)
    const docShingles = createShingles(documentText, 3);

    if (docShingles.size === 0) {
        return { percentage: 0, topMatches: [], method: 'shingling-jaccard' };
    }

    const matches = [];

    for (const thesis of allTheses) {
        const thesisText = [thesis.title || '', thesis.abstract || ''].join(' ');
        if (thesisText.trim().length < 20) continue; // Skip entries with insufficient text

        const thesisShingles = createShingles(thesisText, 3);
        if (thesisShingles.size === 0) continue;

        // Use both Jaccard and Containment, take the higher score
        const jaccard = jaccardSimilarity(docShingles, thesisShingles);
        const containment = containmentSimilarity(docShingles, thesisShingles);
        const score = Math.max(jaccard, containment);

        if (score > 0.05) { // Only include matches above 5%
            matches.push({
                thesisId: thesis.id,
                title: thesis.title,
                score: Math.round(score * 100)
            });
        }
    }

    // Sort by score descending, take top 5
    matches.sort((a, b) => b.score - a.score);
    const topMatches = matches.slice(0, 5);

    return {
        percentage: topMatches.length > 0 ? topMatches[0].score : 0,
        topMatches,
        method: 'shingling-jaccard'
    };
}


// ============================================================
// LAYER 2: WEB PLAGIARISM CHECK (DuckDuckGo — free, no API key)
// ============================================================

/**
 * Extracts representative sentences from text for web searching.
 * Picks the longest, most substantive sentences (not too short, not headings).
 * 
 * @param {string} text - Full document text
 * @param {number} maxSentences - Maximum sentences to extract
 * @returns {string[]} Array of representative sentences
 */
function extractRepresentativeSentences(text, maxSentences = 8) {
    // Split into sentences
    const rawSentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);

    // Filter: must be 8+ words, not all caps (headings), not too short
    const candidates = rawSentences.filter(s => {
        const words = s.split(/\s+/);
        if (words.length < 8) return false;
        if (words.length > 40) return false; // Too long for search queries
        if (s === s.toUpperCase()) return false; // Skip ALL CAPS headings
        if (/^\d+\s/.test(s)) return false; // Skip numbered items like "1. Introduction"
        return true;
    });

    // Score sentences by uniqueness (longer + more specific = better)
    const scored = candidates.map(s => {
        const words = s.split(/\s+/);
        // Prefer sentences with 12-25 words (ideal search query length)
        const lengthScore = words.length >= 12 && words.length <= 25 ? 2 : 1;
        // Prefer sentences with uncommon/specific words
        const commonWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'but', 'this', 'that', 'it', 'with', 'as', 'by', 'from']);
        const specificWords = words.filter(w => !commonWords.has(w.toLowerCase())).length;
        const specificityScore = specificWords / words.length;

        return { sentence: s, score: lengthScore * specificityScore * words.length };
    });

    // Sort by score, spread selections across the document
    scored.sort((a, b) => b.score - a.score);

    // Take top candidates, but ensure they're spread across the document
    const selected = [];
    const textLength = text.length;

    for (const item of scored) {
        if (selected.length >= maxSentences) break;

        const position = text.indexOf(item.sentence);
        const relativePosition = position / textLength;

        // Ensure we don't pick sentences too close together
        const tooClose = selected.some(s => {
            const sPos = text.indexOf(s) / textLength;
            return Math.abs(relativePosition - sPos) < 0.1; // At least 10% apart
        });

        if (!tooClose) {
            selected.push(item.sentence);
        }
    }

    // If we didn't get enough spread sentences, fill from top-scored
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
 * Searches the web using DuckDuckGo HTML search (completely free, no API key).
 * Parses the lite HTML results page to extract titles, URLs, and snippets.
 * 
 * @param {string} query - Search query (a sentence from the document)
 * @returns {Array} Array of { title, url, snippet }
 */
async function searchDuckDuckGo(query) {
    try {
        // Use a truncated, quoted phrase for exact matching
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

        // Parse results from the HTML response
        // DuckDuckGo lite HTML wraps each result in a class="result" div
        // with class="result__a" for title/link and class="result__snippet" for snippet
        const resultBlocks = html.split(/class="result\s/g).slice(1); // Skip first split (before results)

        for (const block of resultBlocks.slice(0, 5)) {
            // Extract URL from the result link
            const urlMatch = block.match(/href="([^"]+)"/);
            // Extract title text
            const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
            // Extract snippet
            const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

            if (urlMatch && titleMatch) {
                let resultUrl = urlMatch[1];
                // DuckDuckGo wraps URLs in a redirect, extract the actual URL
                const actualUrlMatch = resultUrl.match(/uddg=([^&]+)/);
                if (actualUrlMatch) {
                    resultUrl = decodeURIComponent(actualUrlMatch[1]);
                }

                // Clean snippet HTML tags
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
 * Searches using Serper.dev API if key is available (optional upgrade).
 */
async function searchSerper(query, apiKey) {
    try {
        const searchQuery = `"${query.substring(0, 128)}"`;
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ q: searchQuery, num: 5 })
        });

        if (!response.ok) return [];
        const data = await response.json();
        return (data.organic || []).slice(0, 5).map(item => ({
            title: item.title || '',
            url: item.link || '',
            snippet: item.snippet || ''
        }));
    } catch (err) {
        console.error('Serper search error:', err.message);
        return [];
    }
}

/**
 * Computes text similarity between two strings using word overlap.
 * 
 * @param {string} text1 
 * @param {string} text2 
 * @returns {number} Similarity score between 0 and 1
 */
function snippetSimilarity(text1, text2) {
    const normalize = t => t.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
    const s1 = normalize(text1);
    const s2 = normalize(text2);

    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    // Word-level overlap (more meaningful for natural language)
    const words1 = new Set(s1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(s2.split(' ').filter(w => w.length > 2));

    if (words1.size === 0 || words2.size === 0) return 0;

    let overlap = 0;
    for (const word of words1) {
        if (words2.has(word)) overlap++;
    }

    // Use containment (what fraction of the query words appear in the result)
    return overlap / words1.size;
}

/**
 * Performs web plagiarism check by searching representative sentences online.
 * Uses DuckDuckGo (free, no API key) by default. Falls back to Serper.dev if configured.
 * 
 * @param {string} documentText - Full document text
 * @param {string} serperApiKey - Optional Serper.dev API key for better results
 * @returns {Object} Web plagiarism results
 */
async function checkWebPlagiarism(documentText, serperApiKey) {
    const sentences = extractRepresentativeSentences(documentText, 8);

    if (sentences.length === 0) {
        return { percentage: 0, sourcesFound: 0, matches: [], sentencesChecked: 0 };
    }

    const useSerper = serperApiKey && serperApiKey.trim().length > 0;
    const searchEngine = useSerper ? 'Serper.dev (Google)' : 'DuckDuckGo';

    const allMatches = [];
    const uniqueSources = new Set();
    let totalSimilarity = 0;
    let checkedCount = 0;

    for (const sentence of sentences) {
        // Rate limiting: 600ms delay between queries (be polite to DuckDuckGo/avoid rate limits)
        if (checkedCount > 0) {
            await new Promise(resolve => setTimeout(resolve, useSerper ? 200 : 600));
        }

        const results = useSerper
            ? await searchSerper(sentence, serperApiKey)
            : await searchDuckDuckGo(sentence);

        checkedCount++;

        for (const result of results) {
            // Compare the search snippet with our sentence
            const sim = snippetSimilarity(sentence, result.snippet);

            if (sim > 0.4) { // 40% word overlap threshold
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

        // Track average similarity for sentences that had results
        if (results.length > 0) {
            const bestMatch = results.reduce((best, r) => {
                const sim = snippetSimilarity(sentence, r.snippet);
                return sim > best ? sim : best;
            }, 0);
            totalSimilarity += bestMatch;
        }
    }

    // Sort matches by similarity descending
    allMatches.sort((a, b) => b.similarity - a.similarity);

    // Overall web similarity: average of best matches per sentence
    const avgSimilarity = checkedCount > 0 ? (totalSimilarity / checkedCount) * 100 : 0;

    return {
        percentage: Math.round(avgSimilarity),
        sourcesFound: uniqueSources.size,
        sentencesChecked: checkedCount,
        searchEngine,
        matches: allMatches.slice(0, 10), // Top 10 matches
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
 * @param {Object} options - { serperApiKey: string } (optional, for better web results)
 * @returns {Object} Complete plagiarism report
 */
async function performPlagiarismCheck(documentText, allTheses, options = {}) {
    const startTime = Date.now();

    // Layer 1: Local corpus check (always runs — free, fast)
    const localResult = checkLocalSimilarity(documentText, allTheses);

    // Layer 2: Web check (always runs — DuckDuckGo is free with no API key)
    const webResult = await checkWebPlagiarism(documentText, options.serperApiKey || '');

    // Combined overall score: weighted average
    // Local gets 40% weight, Web gets 60% weight (web is more authoritative)
    const overallScore = Math.round(
        (localResult.percentage * 0.4) + (webResult.percentage * 0.6)
    );

    // Determine verdict
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
    extractRepresentativeSentences
};
