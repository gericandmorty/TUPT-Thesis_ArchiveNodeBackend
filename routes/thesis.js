const express = require('express');
const router = express.Router();
const Thesis = require('../models/Thesis');
const LocalComparison = require('../models/LocalComparison');
const auth = require('../middleware/auth');
const { generateText } = require('../modules/ai');
const { redis, getSearchCacheVersion } = require('../modules/cache');
const { findSimilarity } = require('../modules/documentAnalyzer');

// --- STATIC ROUTES FIRST ---

// @route   GET /thesis/health
router.get('/health', auth, (req, res) => {
    res.json({ status: 'ok', version: 'v19-final-check' });
});

// @route   GET /thesis/count
// @desc    Get total number of thesis records
router.get('/count', auth, async (req, res) => {
    try {
        const count = await Thesis.countDocuments({ isApproved: true });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ message: 'Error counting theses', error: err.message });
    }
});

// @route   GET /thesis/years
// @desc    Get all unique years for filtering
router.get('/years', auth, async (req, res) => {
    try {
        const years = await Thesis.distinct('year_range', { isApproved: true });
        const sortedYears = years.filter(y => y && y !== 'unknown').sort().reverse();
        res.json(sortedYears);
    } catch (error) {
        console.error('Error fetching years:', error);
        res.status(500).json({ message: 'Error fetching years' });
    }
});

// @route   GET /thesis/categories
// @desc    Get all unique categories for filtering
router.get('/categories', auth, async (req, res) => {
    try {
        const categories = await Thesis.distinct('category', { isApproved: true });
        const sortedCategories = categories.filter(c => c && c !== 'General').sort();
        res.json(['all', ...sortedCategories]);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Error fetching categories' });
    }
});

// @route   GET /thesis/department-counts
// @desc    Get counts grouped by department/category
router.get('/department-counts', auth, async (req, res) => {
    try {
        const counts = await Thesis.aggregate([
            {
                $match: { isApproved: true }
            },
            {
                $group: {
                    _id: "$category",
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        // Transform for easier frontend consumption
        const formattedCounts = counts.map(c => ({
            category: c._id || 'Uncategorized',
            count: c.count
        }));

        res.json(formattedCounts);
    } catch (err) {
        console.error('Error aggregating department counts:', err);
        res.status(500).json({ message: 'Error aggregating counts', error: err.message });
    }
});

// --- DYNAMIC/SEARCH ROUTES SECOND ---

// @route   GET /thesis/search
// @desc    Search theses by title, author, or abstract using regex and text index
router.get('/search', auth, async (req, res) => {
    try {
        const { query, year, type, category, since, sort, startDate, endDate } = req.query;

        // --- CACHE CHECK ---
        let cacheKey = null;
        if (redis) {
            const searchVersion = await getSearchCacheVersion();
            // Create a unique key for this exact search query, bound to the current version namespace
            const queryHash = Buffer.from(JSON.stringify(req.query)).toString('base64');
            if (searchVersion) {
                cacheKey = `thesis_search:${searchVersion}:${queryHash}`;
                try {
                    const cachedData = await redis.get(cacheKey);
                    if (cachedData) {
                        return res.json(typeof cachedData === 'string' ? JSON.parse(cachedData) : cachedData);
                    }
                } catch (cacheErr) {
                    console.error("Redis Cache GET Error:", cacheErr);
                    // Fail gracefully and continue to DB query
                }
            }
        }
        // --- END CACHE CHECK ---

        let filter = { isApproved: true };

        if (year && year !== 'all') {
            filter.year_range = year;
        }

        if (since) {
            // Handle "Since [Year]" from sidebar
            filter.year_range = { $gte: since };
        }

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                filter.createdAt.$lte = end;
            }
        }

        if (category && category !== 'all') {
            filter.category = category;
        }

        if (query) {
            const searchRegex = new RegExp(query, 'i');
            if (type === 'title') {
                filter.title = searchRegex;
            } else if (type === 'abstract') {
                filter.abstract = searchRegex;
            } else {
                filter.$or = [
                    { title: searchRegex },
                    { author: searchRegex },
                    { abstract: searchRegex }
                ];
            }
        }

        let sortOption = { createdAt: -1 };
        if (sort === 'date') {
            sortOption = { createdAt: -1 }; // Already default, but explicit for clarity
        } else if (sort === 'relevance' && query) {
            // MongoDB text search relevance sorting is handled by score
            // For now, we'll stick to createdAt unless we implement full text score sorting
            sortOption = { createdAt: -1 };
        }

        // Build the aggregation pipeline
        let pipeline = [];

        // 1. Initial Match (Filter)
        pipeline.push({ $match: filter });

        // 2. Add Sort Year field (extract first 4 digits from year_range or use 0 for unknown)
        pipeline.push({
            $addFields: {
                numericYear: {
                    $cond: {
                        if: { $regexMatch: { input: "$year_range", regex: /\d{4}/ } },
                        then: {
                            $convert: {
                                input: { $indexOfBytes: ["$year_range", "2"] }, // Simple check for 20xx
                                to: "int",
                                onError: 0
                            }
                        },
                        else: 0
                    }
                }
            }
        });

        // Improved numeric extraction for "sortYear"
        pipeline[1].$addFields.sortYear = {
            $let: {
                vars: {
                    yearMatch: { $regexFind: { input: "$year_range", regex: /\d{4}/ } }
                },
                in: {
                    $cond: [
                        { $gt: ["$$yearMatch", null] },
                        { $convert: { input: "$$yearMatch.match", to: "int", onError: 0 } },
                        0
                    ]
                }
            }
        };

        // 3. Sort logic: Valid years (desc) first, then unknown (0)
        // We use a helper field to treat 0 as very small
        pipeline.push({
            $sort: {
                sortYear: -1,
                createdAt: -1
            }
        });

        // 4. Limit results
        pipeline.push({ $limit: 50 });

        const results = await Thesis.aggregate(pipeline);

        // --- CACHE SAVE ---
        if (redis && cacheKey) {
            try {
                // Cache for 86400 seconds (1 day)
                await redis.set(cacheKey, JSON.stringify(results), { ex: 86400 });
            } catch (cacheErr) {
                console.error("Redis Cache SET Error:", cacheErr);
            }
        }
        // --- END CACHE SAVE ---

        res.json(results);
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ message: 'Server error during search' });
    }
});

// @route   GET /thesis/:id
// @desc    Get single thesis by ID
router.get('/:id', auth, async (req, res) => {
    try {
        const thesis = await Thesis.findOne({ id: req.params.id, isApproved: true });
        if (!thesis) {
            return res.status(404).json({ message: 'Thesis not found' });
        }
        res.json(thesis);
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ message: 'Server error fetching thesis' });
    }
});

// @route   POST /thesis/recommendations
// @desc    Get AI-generated thesis recommendations based on a prompt or context
router.post('/recommendations', auth, async (req, res) => {
    try {
        const { prompt, query } = req.body;

        if (!prompt) {
            return res.status(400).json({ message: 'Please provide a prompt for the AI' });
        }

        // Check if the query is just a single word
        const targetQuery = query || prompt;
        if (targetQuery && targetQuery.trim().split(/\s+/).length <= 1) {
            return res.json({ 
                recommendation: "In the analysis on recommending and comparison of the title, one word isn't enough for a valid title." 
            });
        }

        const aiResponse = await generateText(prompt);

        res.json({ recommendation: aiResponse });
    } catch (error) {
        console.error('Error generating AI recommendation:', error);
        res.status(500).json({ message: 'Server error generating AI recommendation' });
    }
});

// @route   POST /thesis/compare-local
// @desc    Compare a proposed title against the local archive and suggest improvements
router.post('/compare-local', auth, async (req, res) => {
    try {
        const { title } = req.body;

        if (!title) {
            return res.status(400).json({ message: 'Please provide a title to compare' });
        }

        // Check if the title is just a single word
        if (title.trim().split(/\s+/).length <= 1) {
            return res.json({
                success: true,
                similarity: 0,
                match: null,
                recommendation: "In the analysis on recommending and comparison of the title, one word isn't enough for a valid title."
            });
        }

        const allTheses = await Thesis.find({ isApproved: true }).select('title abstract id');
        
        // Use findSimilarity logic but weighted heavily towards title for this specific check
        // We'll calculate a manual title-only similarity check here
        let maxSim = 0;
        let bestMatch = null;
        
        const { calculateSimilarity } = require('../modules/documentAnalyzer'); // Helper if needed, or just use findSimilarity with empty abstract

        // Use findSimilarity with an empty abstract to focus on title, but let's do a title-focused check
        const result = await findSimilarity(title, "", allTheses);
        
        // Also do a pure title match check
        let pureTitleSim = 0;
        let pureTitleMatch = null;
        
        for (const t of allTheses) {
            const sim = calculateSimilarity(title, t.title);
            if (sim > pureTitleSim) {
                pureTitleSim = sim;
                pureTitleMatch = t;
            }
        }

        let aiPrompt = "";
        if (pureTitleSim > 0.4) {
             aiPrompt = `
                The user wants to use this thesis title: "${title}".
                Our archive already has a very similar title: "${pureTitleMatch.title}".
                
                Please suggest 3-5 improved, more specific, and unique title variations that:
                1. Avoid duplicating the existing research.
                2. Use stronger academic vocabulary.
                3. Are more professional and specific.
                
                Format the response with these sections:
                Analysis: [Briefly explain why it's too similar]
                Improvements: [Bulleted list of new title ideas]
                Final Tip: [A short piece of advice on uniqueness]
            `;
        } else {
            aiPrompt = `
                The user wants to use this thesis title: "${title}".
                It seems fairly unique compared to our archive.
                
                Please suggest 3-5 ways to polish or improve this title to make it sound more professional and academic.
                
                Format the response with these sections:
                Analysis: [Briefly evaluate the current title]
                Improvements: [Bulleted list of polished title ideas]
                Final Tip: [A short piece of advice on academic titles]
            `;
        }

        const recommendation = await generateText(aiPrompt);

        // Save to history if user is authenticated
        if (req.user) {
            try {
                const historyEntry = new LocalComparison({
                    user: req.user,
                    searchQuery: title,
                    similarityScore: Math.round(pureTitleSim * 100),
                    matchedTitle: pureTitleMatch ? pureTitleMatch.title : null,
                    matchedId: pureTitleMatch ? pureTitleMatch.id : null,
                    recommendation: recommendation
                });
                await historyEntry.save();
            } catch (saveErr) {
                console.error('Failed to save local comparison history:', saveErr);
                // Don't fail the request just because history saving failed
            }
        }

        res.json({
            success: true,
            similarity: Math.round(pureTitleSim * 100),
            match: pureTitleMatch ? {
                id: pureTitleMatch.id,
                title: pureTitleMatch.title
            } : null,
            recommendation
        });

    } catch (err) {
        console.error('Local comparison error:', err);
        res.status(500).json({ success: false, message: 'Error during local comparison', error: err.message });
    }
});

module.exports = router;
