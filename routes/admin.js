const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Thesis = require('../models/Thesis');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { invalidateSearchCache } = require('../modules/cache');

// Apply admin protection to all routes in this file
router.use(auth, admin);

// @route   GET /admin/stats
// @desc    Get dashboard statistics
router.get('/stats', async (req, res) => {
    try {
        const [userCount, thesisCount, pendingCount] = await Promise.all([
            User.countDocuments(),
            Thesis.countDocuments(),
            Thesis.countDocuments({ isApproved: false })
        ]);

        // Fetch monthly data for the last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const [userMonthly, thesisMonthly] = await Promise.all([
            User.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                {
                    $group: {
                        _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            Thesis.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                {
                    $group: {
                        _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ])
        ]);

        // Format chart data
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const chartData = [];

        for (let i = 0; i < 6; i++) {
            const date = new Date();
            date.setMonth(date.getMonth() - (5 - i));
            const m = date.getMonth() + 1;
            const y = date.getFullYear();

            const userData = userMonthly.find(d => d._id.month === m && d._id.year === y);
            const thesisData = thesisMonthly.find(d => d._id.month === m && d._id.year === y);

            chartData.push({
                name: monthNames[m - 1],
                users: userData ? userData.count : 0,
                theses: thesisData ? thesisData.count : 0
            });
        }

        res.json({
            success: true,
            data: {
                users: userCount,
                theses: thesisCount,
                pending: pendingCount,
                chartData
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching stats', error: err.message });
    }
});

// ==========================
// USER MANAGEMENT
// ==========================

// @route   GET /admin/users
// @desc    Get all users (paginated & searchable)
router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const query = search ? {
            $or: [
                { name: { $regex: search, $options: 'i' } },
                { idNumber: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const [users, total] = await Promise.all([
            User.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            User.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: users,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                currentPage: page,
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching users', error: err.message });
    }
});

// @route   GET /admin/users/:id
// @desc    Get single user details
router.get('/users/:id', async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching user', error: err.message });
    }
});

// @route   PUT /admin/users/:id
// @desc    Update user details
router.put('/users/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'User updated successfully', data: user });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating user', error: err.message });
    }
});

// @route   DELETE /admin/users/:id
// @desc    Delete a user
router.delete('/users/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting user', error: err.message });
    }
});

// ==========================
// THESIS MANAGEMENT
// ==========================

// @route   GET /admin/theses
// @desc    Get all theses (paginated & searchable)
router.get('/theses', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const search = req.query.search || '';
        const skip = (page - 1) * limit;

        const query = search ? {
            $or: [
                { title: { $regex: search, $options: 'i' } },
                { author: { $regex: search, $options: 'i' } }
            ]
        } : {};

        const [theses, total] = await Promise.all([
            Thesis.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Thesis.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: theses,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                currentPage: page,
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching theses', error: err.message });
    }
});

// @route   POST /admin/theses
// @desc    Create a new thesis entry
router.post('/theses', async (req, res) => {
    try {
        const thesis = new Thesis(req.body);
        await thesis.save();
        
        await invalidateSearchCache();

        res.status(201).json({ success: true, message: 'Thesis created successfully', data: thesis });
    } catch (err) {
        if (err.code === 11000) {
            return res.status(400).json({ success: false, message: 'Thesis with this ID already exists' });
        }
        res.status(500).json({ success: false, message: 'Error creating thesis', error: err.message });
    }
});

// @route   PUT /admin/theses/:id (using MongoDB _id)
// @desc    Update thesis details
router.put('/theses/:id', async (req, res) => {
    try {
        const thesis = await Thesis.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!thesis) return res.status(404).json({ success: false, message: 'Thesis not found' });
        
        await invalidateSearchCache();

        res.json({ success: true, message: 'Thesis updated successfully', data: thesis });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error updating thesis', error: err.message });
    }
});

// @route   DELETE /admin/theses/:id (using MongoDB _id)
// @desc    Delete a thesis
router.delete('/theses/:id', async (req, res) => {
    try {
        const thesis = await Thesis.findByIdAndDelete(req.params.id);
        if (!thesis) return res.status(404).json({ success: false, message: 'Thesis not found' });
        
        await invalidateSearchCache();

        res.json({ success: true, message: 'Thesis deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting thesis', error: err.message });
    }
});

module.exports = router;
