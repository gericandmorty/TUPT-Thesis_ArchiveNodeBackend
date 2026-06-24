const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Thesis = require('../models/Thesis');
const LocalComparison = require('../models/LocalComparison');
const auth = require('../middleware/auth');
const { optionalAuth } = auth;
const { generateText } = require('../modules/ai');
const { redis, getSearchCacheVersion, invalidateSearchCache } = require('../modules/cache');
const { findSimilarity, extractText } = require('../modules/documentAnalyzer');
const AiHistory = require('../models/AiHistory');
const Collaboration = require('../models/Collaboration');
const professorMiddleware = require('../middleware/professor');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configure memory storage for parsing files
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// @route   GET /thesis/assigned/count
// @desc    Get count of theses assigned to the logged-in professor
router.get('/assigned/count', auth, professorMiddleware, async (req, res) => {
    try {
        const count = await Thesis.countDocuments({ professorId: req.user, isApproved: false });
        res.json({ success: true, count });
    } catch (err) {
        console.error('Fetch assigned count error:', err);
        res.status(500).json({ success: false, message: 'Error fetching assigned count', error: err.message });
    }
});

// @route   GET /thesis/assigned
// @desc    Get all theses assigned to the logged-in professor for approval
router.get('/assigned', auth, professorMiddleware, async (req, res) => {
    try {
        const theses = await Thesis.find({ professorId: req.user }).sort({ createdAt: -1 });
        
        // Enhance theses with duplicate information
        const enhancedTheses = await Promise.all(theses.map(async (thesis) => {
            const thesisObj = thesis.toObject();
            
            // Escape special regex characters in the title
            const cleanTitle = thesis.title.trim().toLowerCase();
            const escapedTitle = cleanTitle.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            
            const duplicates = await Thesis.find({
                _id: { $ne: thesis._id },
                title: { $regex: new RegExp(`^${escapedTitle}$`, 'i') },
                isRejected: { $ne: true }
            });
            
            thesisObj.duplicates = duplicates;
            thesisObj.hasDuplicate = duplicates.length > 0;
            return thesisObj;
        }));

        res.json({ success: true, data: enhancedTheses });
    } catch (err) {
        console.error('Fetch assigned theses error:', err);
        res.status(500).json({ success: false, message: 'Error fetching assigned theses', error: err.message });
    }
});

// @route   PATCH /thesis/:id/approve
// @desc    Approve a thesis (Professors can only approve theses assigned to them)
router.patch('/:id/approve', auth, professorMiddleware, async (req, res) => {
    try {
        const thesis = await Thesis.findById(req.params.id);
        
        if (!thesis) {
            return res.status(404).json({ success: false, message: 'Thesis not found' });
        }

        // Only allow if professor is the one assigned or if user is admin
        const User = require('../models/User');
        const currentUser = await User.findById(req.user);

        if (!currentUser.isAdmin && thesis.professorId && thesis.professorId.toString() !== req.user.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to approve this thesis.' });
        }

        thesis.isProfApproved = true;
        thesis.approvedBy = req.user;
        thesis.approvedAt = new Date();
        await thesis.save();
        
        await invalidateSearchCache();

        // Notify student of professor approval
        if (thesis.createdBy) {
            try {
                const Notification = require('../models/Notifcation');
                const notif = new Notification({
                    recipient: thesis.createdBy,
                    sender: req.user,
                    title: 'Thesis Approved by Faculty',
                    message: `Your thesis "${thesis.title}" has been approved by Faculty Member ${currentUser.name}.`,
                    type: 'thesis_approved_prof',
                    link: '/documents/submissions'
                });
                await notif.save();
            } catch (notifErr) {
                console.error('Failed to create prof approval notification:', notifErr);
            }
        }

        // Notify all Admin/Librarian users that the thesis is ready for review
        try {
            const Notification = require('../models/Notifcation');
            const admins = await User.find({ isAdmin: true });
            for (const admin of admins) {
                const notif = new Notification({
                    recipient: admin._id,
                    sender: req.user,
                    title: 'Thesis Pending Librarian Approval',
                    message: `The thesis "${thesis.title}" has been approved by Faculty Member ${currentUser.name} and is ready for librarian review.`,
                    type: 'thesis_approved_prof_notify_admin',
                    link: '/admin/theses'
                });
                await notif.save();
            }
        } catch (adminNotifErr) {
            console.error('Failed to notify admins of prof approval:', adminNotifErr);
        }

        res.json({ success: true, message: 'Thesis approved successfully', data: thesis });
    } catch (err) {
        console.error('Approval error:', err);
        res.status(500).json({ success: false, message: 'Error approving thesis', error: err.message });
    }
});

// @route   PATCH /thesis/:id/disapprove
// @desc    Disapprove a thesis
router.patch('/:id/disapprove', auth, professorMiddleware, async (req, res) => {
    try {
        const thesis = await Thesis.findById(req.params.id);
        
        if (!thesis) {
            return res.status(404).json({ success: false, message: 'Thesis not found' });
        }

        const User = require('../models/User');
        const currentUser = await User.findById(req.user);

        if (!currentUser.isAdmin && thesis.professorId && thesis.professorId.toString() !== req.user.toString()) {
            return res.status(403).json({ success: false, message: 'Access denied. You are not assigned to this thesis.' });
        }

        thesis.isProfApproved = false;
        thesis.approvedBy = null;
        thesis.approvedAt = null;
        thesis.isRejected = true;
        thesis.rejectedByRole = 'faculty';
        thesis.deleteAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
        await thesis.save();
        
        await invalidateSearchCache();

        // Notify student of professor disapproval
        if (thesis.createdBy) {
            try {
                const Notification = require('../models/Notifcation');
                const notif = new Notification({
                    recipient: thesis.createdBy,
                    sender: req.user,
                    title: 'Thesis Rejected by Faculty',
                    message: `Your thesis "${thesis.title}" has been rejected by Faculty Member ${currentUser.name} and will be auto-deleted in 5 days if not resubmitted.`,
                    type: 'thesis_rejected_prof',
                    link: '/documents/submissions'
                });
                await notif.save();
            } catch (notifErr) {
                console.error('Failed to create prof disapproval notification:', notifErr);
            }
        }

        res.json({ success: true, message: 'Thesis disapproved successfully', data: thesis });
    } catch (err) {
        console.error('Disapproval error:', err);
        res.status(500).json({ success: false, message: 'Error disapproving thesis', error: err.message });
    }
});

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

// @route   GET /thesis/courses
// @desc    Get all unique courses for filtering
router.get('/courses', auth, async (req, res) => {
    try {
        const courses = await Thesis.distinct('course', { isApproved: true });
        const sortedCourses = courses.filter(c => c && c !== 'General').sort();
        res.json(['all', ...sortedCourses]);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ message: 'Error fetching courses' });
    }
});

// @route   GET /thesis/department-counts
// @desc    Get counts grouped by department/course
router.get('/department-counts', auth, async (req, res) => {
    try {
        const counts = await Thesis.aggregate([
            {
                $match: { isApproved: true }
            },
            {
                $group: {
                    _id: "$course",
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        // Transform for easier frontend consumption
        const formattedCounts = counts.map(c => ({
            course: c._id || 'Uncategorized',
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
        const { query, year, type, course, since, sort, startDate, endDate } = req.query;

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
            if (/^\d{4}$/.test(year)) {
                filter.year_range = { $regex: year, $options: 'i' };
            } else {
                filter.year_range = year;
            }
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

        if (course && course !== 'all') {
            const courseLower = course.toLowerCase();
            if (courseLower === 'uncategorized') {
                filter.course = { $in: [null, 'Uncategorized', 'uncategorized', '', 'uncategorized'] };
            } else {
                filter.course = { $regex: new RegExp(`^${course}$`, 'i') };
            }
        }

        if (query) {
            const searchRegex = new RegExp(query, 'i');
            if (type === 'title') {
                filter.title = searchRegex;
            } else if (type === 'abstract') {
                filter.abstract = searchRegex;
            } else if (type === 'author') {
                filter.author = searchRegex;
            } else if (type === 'year') {
                filter.year_range = searchRegex;
            } else if (type === 'course') {
                filter.course = searchRegex;
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

        // 4. Populate createdBy details
        pipeline.push({
            $lookup: {
                from: 'users',
                localField: 'createdBy',
                foreignField: '_id',
                as: 'creator'
            }
        });
        pipeline.push({
            $addFields: {
                isUploadedByUndergrad: {
                    $cond: {
                        if: { $ne: ["$createdBy", null] }, // If ANY user ID is present on the thesis
                        then: {
                            $cond: {
                                if: { $gt: [{ $size: "$creator" }, 0] },
                                // Confirm it's NOT an alumni account
                                then: { $ne: [{ $arrayElemAt: ["$creator.isGraduate", 0] }, true] },
                                else: true // If we see a createdBy but no User doc, treat as student (permissive)
                            }
                        },
                        else: false // System/OCR: No collaboration button
                    }
                },
                createdBy: { $toString: "$createdBy" }
            }
        });
        // We keep createdBy, but we can also project it explicitly if needed
        pipeline.push({ $project: { creator: 0 } });

        // 5. Check if the current user has already requested collaboration
        if (req.user) {
            pipeline.push({
                $lookup: {
                    from: 'collaborations',
                    let: { thesisId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$thesis', '$$thesisId'] },
                                        { $eq: [{ $toString: '$alumni' }, req.user.toString()] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'userCollaboration'
                }
            });
            pipeline.push({
                $addFields: {
                    hasRequestedCollaboration: { $gt: [{ $size: '$userCollaboration' }, 0] }
                }
            });
            pipeline.push({ $project: { userCollaboration: 0 } });
        } else {
            pipeline.push({ $addFields: { hasRequestedCollaboration: false } });
        }

        // 6. Limit results
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

// @route   GET /thesis/find-one/:id
// @desc    Get single thesis by ID
router.get('/find-one/:id', auth, async (req, res) => {
    try {
        const idParam = req.params.id;
        let thesis;

        // Check if idParam is a valid MongoDB ObjectId
        if (idParam.match(/^[0-9a-fA-F]{24}$/)) {
            thesis = await Thesis.findOne({
                $or: [{ _id: idParam }, { id: idParam }]
            });
        } else {
            thesis = await Thesis.findOne({ id: idParam });
        }

        if (!thesis) {
            return res.status(404).json({ message: 'Thesis not found' });
        }

        // Access control: If not approved, only Admin, the Creator, or the Assigned Professor can see it
        const User = mongoose.model('User');
        const currentUser = await User.findById(req.user);

        if (!thesis.isApproved && !currentUser?.isAdmin) {
            const isCreator = thesis.createdBy && thesis.createdBy.toString() === req.user.toString();
            const isAssignedProf = thesis.professorId && thesis.professorId.toString() === req.user.toString();
            
            if (!isCreator && !isAssignedProf) {
                return res.status(403).json({ message: 'Thesis pending approval' });
            }
        }

        // Add undergrad status
        const thesisData = thesis.toObject();
        if (thesis.createdBy) {
            const creator = await User.findById(thesis.createdBy);
            // Relaxed check: Undergrad if isGraduate is NOT true (handles missing fields)
            thesisData.isUploadedByUndergrad = creator ? (creator.isGraduate !== true) : true;
            thesisData.createdBy = thesis.createdBy.toString();
        } else {
            thesisData.isUploadedByUndergrad = false;
        }

        // Check for existing collaboration request
        if (req.user) {
            const existingCollab = await Collaboration.findOne({
                thesis: thesis._id,
                alumni: req.user
            });
            thesisData.hasRequestedCollaboration = !!existingCollab;
        } else {
            thesisData.hasRequestedCollaboration = false;
        }

        res.json(thesisData);
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
        const targetQuery = query || prompt;

        if (!targetQuery) {
            return res.status(400).json({ message: 'Please provide a prompt for the AI' });
        }

        // Check if the query is just a single word
        if (targetQuery.trim().split(/\s+/).length <= 1) {
            return res.json({ 
                recommendation: "In the analysis on recommending and comparison of the title, one word isn't enough for a valid title." 
            });
        }

        const aiPrompt = `
            Role: Senior Academic Research Consultant & Strategic Advisor
            Context: A student is seeking institutional research guidance based on their initial query or interest.
            
            Subject Query: "${targetQuery}"
            
            Task: Generate a professional "Strategic Research Intelligence & Recommendation Report". 
            Transform the provided query into specific, academically rigorous thesis titles.
            
            Structure your response EXACTLY with these sections:
            
            Strategic Research Intelligence & Recommendation Report
            Subject Query: "${targetQuery}"
            
            Functional Requirements:
            Provide a deep analysis of why this specific query needs refinement. Discuss the necessary academic scope, methodology, and potential contribution to the field. Explain what makes a strong thesis title in this specific area.
            
            Conclusion:
            Provide a authoritative summary of how the research transitions from a general idea to a structured, institutional investigation.
            
            Recommendations:
            1. "[Polished Thesis Title 1]"
            Rationale: Detail why this title is academically superior and its specific research focus.
            
            2. "[Polished Thesis Title 2]"
            Rationale: Detail why this title is academically superior and its specific research focus.
            
            3. "[Polished Thesis Title 3]"
            Rationale: Detail why this title is academically superior and its specific research focus.
            
            CRITICAL FORMATTING RULES:
            - Start EXACTLY with the header: Strategic Research Intelligence & Recommendation Report
            - Use EXACTLY the headers: Functional Requirements:, Conclusion:, Recommendations:
            - DO NOT include square brackets [ ] in your sections.
            - DO NOT wrap headers in asterisks or markdown bolding.
            - Use double newlines between sections.
            - Maintain an authoritative, institutional, and highly professional tone.
        `;

        const aiResponse = await generateText(aiPrompt);

        // Save to history if user is authenticated
        if (req.user) {
            try {
                const historyEntry = new AiHistory({
                    user: req.user.id || req.user,
                    prompt: targetQuery,
                    recommendation: aiResponse
                });
                await historyEntry.save();
            } catch (saveErr) {
                console.error('Failed to save AI history:', saveErr);
            }
        }

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
                Role: Senior Academic Research Consultant
                Context: A student is proposing a thesis title that is highly similar to an existing work in our TUPT archive.
                
                Thesis Title: "${title}"
                Existing Similar Match: "${pureTitleMatch.title}"
                
                Task: Analyze the overlap and provide strictly academic recommendations.
                
                Requirements:
                1. Scope: Only discuss academic research and methodology.
                2. Tone: Professional and authoritative.
                3. Reject non-research topics: If the query is unrelated to academia, politely state it's out of scope.
                
                CRITICAL FORMATTING RULES:
                - Use EXACTLY these section headers: Analysis:, Improvements:, Final Tip:
                - DO NOT wrap headers in asterisks (NO *Analysis:*, NO **Analysis:**).
                - Use double newlines (\\n\\n) between sections.
                - For "Improvements", provide a clear list.
                
                Format your response EXACTLY as follows:
                Analysis: [Explain the institutional overlap]
                
                Improvements:
                - [Specific Variation 1]
                - [Specific Variation 2]
                - [Specific Variation 3]
                
                Final Tip: [Brief expert advice]
            `;
        } else {
            aiPrompt = `
                Role: Senior Academic Research Consultant
                Context: A student is proposing a new thesis title: "${title}".
                
                Task: Evaluate and polish this title for academic rigor.
                
                Requirements:
                1. Scope: Focus on academic clarity and methodological strength.
                2. Tone: Expert-level.
                3. Reject non-research topics: If the query is unrelated to academia, politely state it's out of scope.
                
                CRITICAL FORMATTING RULES:
                - Use EXACTLY these section headers: Analysis:, Improvements:, Final Tip:
                - DO NOT wrap headers in asterisks (NO *Analysis:*, NO **Analysis:**).
                - Use double newlines (\\n\\n) between sections.
                
                Format your response EXACTLY as follows:
                Analysis: [Assess the academic potential]
                
                Improvements:
                - [Polished Variation 1]
                - [Polished Variation 2]
                - [Polished Variation 3]
                
                Final Tip: [Brief expert tip]
            `;
        }

        const recommendation = await generateText(aiPrompt);

        // Save to history if user is authenticated
        if (req.user) {
            try {
                // Save to detailed LocalComparison history
                const localEntry = new LocalComparison({
                    user: req.user.id || req.user,
                    searchQuery: title,
                    similarityScore: Math.round(pureTitleSim * 100),
                    matchedTitle: pureTitleMatch ? pureTitleMatch.title : null,
                    matchedId: pureTitleMatch ? pureTitleMatch.id : null,
                    recommendation: recommendation
                });
                await localEntry.save();

                // Also save to general AiHistory for unified view
                const aiEntry = new AiHistory({
                    user: req.user.id || req.user,
                    prompt: `[Similarity Check] ${title}`,
                    recommendation: recommendation
                });
                await aiEntry.save();
            } catch (saveErr) {
                console.error('Failed to save comparison history:', saveErr);
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

const DEPARTMENTS = [
    'BENG', 'BET', 'BETEM', 'BETICT', 'BETMC', 'BETMT', 'BETNT',
    'BSCE', 'BSECE', 'BSEE', 'BSES', 'BSIT', 'BSME',
    'BTAU', 'BTTE', 'BTVED', 'BTVTED'
];

const parseAbstractFromTxt = (rawText) => {
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rawSentences = normalized
        .split(/(?<=[.!?])\s+|\n+/)
        .map(s => s.trim())
        .filter(s => s.length >= 10);

    const seen = new Set();
    const unique = rawSentences.filter(s => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    const boilerplate = [
        /^abstract[:\s]*/i,
        /^keywords?[:\s]*/i,
        /^introduction[:\s]*/i,
        /^chapter\s+\d+/i,
        /^(\d+\.?\s*)+$/,
        /^page\s+\d+$/i,
    ];
    const cleaned = unique.filter(s =>
        !boilerplate.some(pattern => pattern.test(s.trim()))
    );

    return cleaned.join(' ');
};

const dissectThesisTxt = (rawText) => {
    const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').map(l => l.trim());
    
    let title = '';
    let author = '';
    let year_range = '';
    let course = '';
    let abstract = '';

    const isHeader = (line) => {
        return /^(abstract|keywords?|introduction|acknowledgements|chapter|table of contents|references)/i.test(line);
    };

    let abstractStartIndex = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*abstract\s*$/i.test(lines[i]) || /^abstract\s*[:\-—]/i.test(lines[i])) {
            abstractStartIndex = i;
            break;
        }
    }

    if (abstractStartIndex === -1) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes('abstract')) {
                abstractStartIndex = i;
                break;
            }
        }
    }

    if (abstractStartIndex === -1) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length > 120 && !isHeader(lines[i]) && !lines[i].includes('University') && !lines[i].includes('TUP')) {
                abstractStartIndex = i;
                break;
            }
        }
    }

    if (abstractStartIndex !== -1) {
        const abstractLines = [];
        let currentLine = lines[abstractStartIndex];
        const headerMatch = currentLine.match(/^abstract\s*[:\-—]\s*(.*)/i);
        if (headerMatch && headerMatch[1]) {
            abstractLines.push(headerMatch[1]);
        } else if (abstractStartIndex !== -1 && !/^\s*abstract\s*$/i.test(currentLine)) {
            abstractLines.push(currentLine);
        }
        
        for (let i = abstractStartIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line === '') continue;
            if (/^(keywords?|introduction|acknowledgements|chapter|table of contents|references|index|background|objectives)/i.test(line)) {
                break;
            }
            abstractLines.push(line);
        }
        abstract = parseAbstractFromTxt(abstractLines.join('\n'));
    }

    const limit = (abstractStartIndex !== -1 && abstractStartIndex > 0) ? abstractStartIndex : Math.min(lines.length, 15);
    const headerLines = lines.slice(0, limit).filter(l => l !== '');

    for (const line of lines) {
        const upperLine = line.toUpperCase();
        for (const dept of DEPARTMENTS) {
            const regex = new RegExp('\\b' + dept + '\\b', 'i');
            if (regex.test(upperLine)) {
                course = dept;
                break;
            }
        }
        if (course) break;
    }

    if (!course) {
        const textUpper = rawText.toUpperCase();
        if (textUpper.includes('INFORMATION TECHNOLOGY') || textUpper.includes('INFO TECH')) {
            course = 'BSIT';
        } else if (textUpper.includes('CIVIL ENGINEERING')) {
            course = 'BSCE';
        } else if (textUpper.includes('ELECTRONICS ENGINEERING') || textUpper.includes('ECE')) {
            course = 'BSECE';
        } else if (textUpper.includes('ELECTRICAL ENGINEERING') || textUpper.includes('BSEE')) {
            course = 'BSEE';
        } else if (textUpper.includes('MECHANICAL ENGINEERING') || textUpper.includes('BSME')) {
            course = 'BSME';
        }
    }

    for (const line of lines) {
        const rangeMatch = line.match(/\b(20\d{2}-\d{4})\b/);
        if (rangeMatch) {
            year_range = rangeMatch[1];
            break;
        }
        const singleMatch = line.match(/\b(20\d{2})\b/);
        if (singleMatch) {
            year_range = singleMatch[1];
        }
    }
    if (!year_range) {
        year_range = new Date().getFullYear().toString();
    }

    let authorLineIdx = -1;
    for (let i = 0; i < headerLines.length; i++) {
        const line = headerLines[i];
        const authorMatch = line.match(/^(author|authors|prepared by|submitted by|by|researcher|researchers|principal author)[:\s]+(.*)/i);
        if (authorMatch) {
            authorLineIdx = i;
            author = authorMatch[2].trim();
            break;
        } else if (/^(author|authors|prepared by|submitted by|by|researcher|researchers|principal author)\s*$/i.test(line)) {
            authorLineIdx = i;
            for (let j = i + 1; j < Math.min(headerLines.length, i + 4); j++) {
                if (headerLines[j] && !headerLines[j].includes(year_range) && !(course && headerLines[j].includes(course))) {
                    author = headerLines[j];
                    break;
                }
            }
            break;
        }
    }

    if (!author) {
        const nameRegex = /^[A-Z][a-zA-Z\'-]+(,\s+[A-Z][a-zA-Z\'-]+(\s+[A-Z]\.?)?|\s+[A-Z][a-zA-Z\'-]+){1,3}$/;
        for (let i = 0; i < headerLines.length; i++) {
            const line = headerLines[i];
            if (line.includes(year_range) || (course && line.includes(course))) continue;
            if (/^(university|college|department|technological university|manila|taguig|tup|tupt|faculty|campus|course|title|year|subject)/i.test(line)) continue;
            if (nameRegex.test(line)) {
                author = line;
                authorLineIdx = i;
                break;
            }
        }
    }

    const titleCandidates = [];
    for (let i = 0; i < headerLines.length; i++) {
        const line = headerLines[i];
        if (i === authorLineIdx || line === author || line.includes(author)) continue;
        if (line.includes(year_range) || (course && line.includes(course))) continue;
        if (/^(university|college|department|technological university|manila|taguig|tup|tupt|faculty|campus|course|year|by|author)/i.test(line)) continue;
        if (isHeader(line)) break;
        titleCandidates.push(line);
    }

    if (titleCandidates.length > 0) {
        title = titleCandidates.slice(0, Math.min(titleCandidates.length, 3)).join(' ');
    }

    if (!title && lines.length > 0) {
        for (const line of lines) {
            if (line !== '' && !line.includes(year_range) && !(course && line.includes(course)) && !/^(university|college|department|technological university|manila|taguig|tup|tupt|faculty|campus|course|year|by|author)/i.test(line)) {
                title = line;
                break;
            }
        }
    }

    let formattedAuthor = author.trim();
    if (formattedAuthor && !formattedAuthor.includes(',') && !formattedAuthor.includes(';')) {
        // 1. Lowercase followed immediately by Uppercase: "DoeJane" -> "Doe, Jane"
        formattedAuthor = formattedAuthor.replace(/([a-z\u00C0-\u00FF])([A-Z])/g, '$1, $2');
        // 2. Period followed by Uppercase: "A.Jane" -> "A., Jane"
        formattedAuthor = formattedAuthor.replace(/\.([A-Z])/g, '., $1');
        // 3. Clean up duplicate spacing/commas
        formattedAuthor = formattedAuthor.replace(/\.,\s+,/g, '.,');
        formattedAuthor = formattedAuthor.replace(/\s{2,}/g, ' ');
        // 4. If there are names separated by space but no commas, e.g. "John A. Doe Jane B. Smith"
        const nameMatches = formattedAuthor.match(/[A-Z][a-zA-Z\u00C0-\u00FF\u00d1\u00f1\'-]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z\u00C0-\u00FF\u00d1\u00f1\'-]+/g);
        if (nameMatches && nameMatches.length > 1) {
            const matchedString = nameMatches.join(' ');
            if (formattedAuthor.replace(/,/g, '').replace(/\s+/g, ' ').trim() === matchedString) {
                formattedAuthor = nameMatches.join(', ');
            }
        }
    }

    return {
        title: title.trim(),
        author: formattedAuthor,
        year_range: year_range.trim(),
        course: course.trim(),
        abstract: abstract.trim()
    };
};

// @route   POST /thesis/parse-txt
// @desc    Dissect and extract metadata fields from raw thesis text
router.post('/parse-txt', auth, (req, res) => {
    try {
        const { text } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, message: 'No text content provided for parsing' });
        }
        
        const parsedData = dissectThesisTxt(text);
        res.json({ success: true, data: parsedData });
    } catch (err) {
        console.error('Parse TXT route error:', err);
        res.status(500).json({ success: false, message: 'Error parsing thesis text', error: err.message });
    }
});

// @route   POST /thesis/parse-file
// @desc    Dissect and extract metadata fields from uploaded PDF, DOCX, or TXT file
router.post('/parse-file', auth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded for parsing' });
        }

        let fullText = '';
        try {
            const pages = await extractText(req.file.buffer, req.file.mimetype);
            fullText = pages.map(p => p.text).join('\n\n');
        } catch (parseErr) {
            console.warn('Local text extraction failed, trying AI fallback:', parseErr.message);

            // If it is a PDF and local parsing fails, let's use Gemini to parse the PDF directly!
            if (req.file.mimetype === 'application/pdf' && process.env.GEMINI_API_KEY) {
                try {
                    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
                    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                    const prompt = `
                        You are an assistant that extracts metadata from a research paper PDF.
                        Analyze the uploaded paper and extract:
                        1. Title: The full title of the paper.
                        2. Author: The lead author name(s). If there are multiple, separate them with a comma (e.g. Dela Cruz J., Santos M.).
                        3. Year: The publication or submission year (e.g., 2024-2025 or 2025).
                        4. Course: The department/course name abbreviation (e.g. BSIT, BSCE, BET, Betem, BETICT, BETMC, BETMT, BETNT, BSECE, BSEE, BSES, BSME, BTAU, BTTE, BTVED, BTVTED).
                        5. Abstract: The abstract summary of the paper.

                        Return a JSON object strictly in this format:
                        {
                            "title": "Extracted Title",
                            "author": "Author Name(s)",
                            "year_range": "Year",
                            "course": "Course",
                            "abstract": "Abstract text"
                        }
                    `;

                    const result = await model.generateContent([
                        {
                            inlineData: {
                                data: req.file.buffer.toString("base64"),
                                mimeType: "application/pdf"
                            }
                        },
                        prompt
                    ]);

                    const aiResponse = result.response.text();
                    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                    if (!jsonMatch) {
                        throw new Error('No JSON object found in AI response');
                    }
                    const parsedData = JSON.parse(jsonMatch[0]);

                    // Clean and normalize author names in the AI result
                    let formattedAuthor = (parsedData.author || '').trim();
                    if (formattedAuthor && !formattedAuthor.includes(',') && !formattedAuthor.includes(';')) {
                        formattedAuthor = formattedAuthor.replace(/([a-z\u00C0-\u00FF])([A-Z])/g, '$1, $2');
                        formattedAuthor = formattedAuthor.replace(/\.([A-Z])/g, '., $1');
                        formattedAuthor = formattedAuthor.replace(/\.,\s+,/g, '.,');
                        formattedAuthor = formattedAuthor.replace(/\s{2,}/g, ' ');
                        const nameMatches = formattedAuthor.match(/[A-Z][a-zA-Z\u00C0-\u00FF\u00d1\u00f1\'-]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-zA-Z\u00C0-\u00FF\u00d1\u00f1\'-]+/g);
                        if (nameMatches && nameMatches.length > 1) {
                            const matchedString = nameMatches.join(' ');
                            if (formattedAuthor.replace(/,/g, '').replace(/\s+/g, ' ').trim() === matchedString) {
                                formattedAuthor = nameMatches.join(', ');
                            }
                        }
                    }
                    parsedData.author = formattedAuthor;

                    // Standardize other fields
                    parsedData.title = (parsedData.title || '').trim();
                    parsedData.year_range = (parsedData.year_range || '').trim();
                    parsedData.course = (parsedData.course || '').trim();
                    parsedData.abstract = (parsedData.abstract || '').trim();

                    return res.json({ success: true, data: parsedData, source: 'ai-fallback' });
                } catch (aiErr) {
                    console.error('AI PDF parsing fallback failed:', aiErr);
                    return res.status(500).json({
                        success: false,
                        message: 'PDF parsing failed: The file has a corrupted structure (e.g. bad XRef table) and AI fallback failed.',
                        error: parseErr.message
                    });
                }
            } else {
                return res.status(500).json({
                    success: false,
                    message: 'Error parsing PDF: The file has a corrupted structure (e.g. bad XRef table). Try converting to DOCX or TXT.',
                    error: parseErr.message
                });
            }
        }

        if (!fullText.trim()) {
            return res.status(400).json({ success: false, message: 'Extracted document text is empty' });
        }

        const parsedData = dissectThesisTxt(fullText);
        res.json({ success: true, data: parsedData });
    } catch (err) {
        console.error('Parse file route error:', err);
        res.status(500).json({ success: false, message: 'Error parsing document file', error: err.message });
    }
});

module.exports = router;
