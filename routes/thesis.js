const express = require('express');
const router = express.Router();
const Thesis = require('../models/Thesis');
const auth = require('../middleware/auth');

// --- STATIC ROUTES FIRST ---

// @route   GET /thesis/health
router.get('/health', auth, (req, res) => {
    res.json({ status: 'ok', version: 'v19-final-check' });
});

// @route   GET /thesis/years
// @desc    Get all unique years for filtering
router.get('/years', auth, async (req, res) => {
    try {
        const years = await Thesis.distinct('year_range');
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
        const categories = await Thesis.distinct('category');
        const sortedCategories = categories.filter(c => c && c !== 'General').sort();
        res.json(['all', ...sortedCategories]);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Error fetching categories' });
    }
});

// --- DYNAMIC/SEARCH ROUTES SECOND ---

// @route   GET /thesis/search
// @desc    Search theses by title, author, or abstract using regex and text index
router.get('/search', auth, async (req, res) => {
    try {
        const { query, year, type, category } = req.query;
        let filter = {};

        if (year && year !== 'all') {
            filter.year_range = year;
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

        const results = await Thesis.find(filter)
            .sort({ createdAt: -1 })
            .limit(50);

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
        const thesis = await Thesis.findOne({ id: req.params.id });
        if (!thesis) {
            return res.status(404).json({ message: 'Thesis not found' });
        }
        res.json(thesis);
    } catch (error) {
        console.error('Fetch error:', error);
        res.status(500).json({ message: 'Server error fetching thesis' });
    }
});

module.exports = router;
