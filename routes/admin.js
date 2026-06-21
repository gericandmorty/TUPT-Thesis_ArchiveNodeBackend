const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Thesis = require('../models/Thesis');
const Collaboration = require('../models/Collaboration');
const SessionHistory = require('../models/SessionHistory');
const AiHistory = require('../models/AiHistory');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { invalidateSearchCache } = require('../modules/cache');
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_ID,
    api_key: process.env.CLOUDINARY_API,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Apply admin protection to all routes in this file
router.use(auth, admin);

// @route   GET /admin/stats
// @desc    Get dashboard statistics
router.get('/stats', async (req, res) => {
    try {
        const [userCount, thesisCount, pendingCount, graduatedCount, collaborationCount] = await Promise.all([
            User.countDocuments(),
            Thesis.countDocuments(),
            Thesis.countDocuments({ isApproved: false }),
            User.countDocuments({ isGraduate: true }),
            Collaboration.countDocuments()
        ]);

        // Fetch monthly data for the last 6 months
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
        sixMonthsAgo.setDate(1);
        sixMonthsAgo.setHours(0, 0, 0, 0);

        const [userMonthly, thesisMonthly, graduateMonthly, collabMonthly, historyMonthly] = await Promise.all([
            User.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            Thesis.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            User.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo }, isGraduate: true } },
                { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            Collaboration.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]),
            AiHistory.aggregate([
                { $match: { createdAt: { $gte: sixMonthsAgo } } },
                { $group: { _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } }, count: { $sum: 1 } } },
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
            const graduateData = graduateMonthly.find(d => d._id.month === m && d._id.year === y);
            const collabData = collabMonthly.find(d => d._id.month === m && d._id.year === y);
            const historyData = historyMonthly.find(d => d._id.month === m && d._id.year === y);

            chartData.push({
                name: monthNames[m - 1],
                users: userData ? userData.count : 0,
                theses: thesisData ? thesisData.count : 0,
                graduated: graduateData ? graduateData.count : 0,
                collaborations: collabData ? collabData.count : 0,
                history: historyData ? historyData.count : 0
            });
        }

        res.json({
            success: true,
            data: {
                users: userCount,
                theses: thesisCount,
                pending: pendingCount,
                graduated: graduatedCount,
                collaborations: collaborationCount,
                students: userCount - graduatedCount,
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

        const query = {};
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { idNumber: { $regex: search, $options: 'i' } }
            ];
        }
        if (req.query.isGraduate !== undefined) {
            query.isGraduate = req.query.isGraduate === 'true';
        }

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
        const { search, course, year, sort, status } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = {};

        // Search logic
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { author: { $regex: search, $options: 'i' } }
            ];
        }

        // Course filter
        if (course && course !== 'all') {
            if (course.toLowerCase() === 'uncategorized') {
                query.course = { $in: [null, 'Uncategorized', 'uncategorized', ''] };
            } else {
                query.course = course;
            }
        }

        // Year filter
        if (year && year !== 'all') {
            const yearLower = year.toLowerCase();
            if (yearLower === 'unknown') {
                query.year_range = { $in: [null, 'unknown', ''] };
            } else if (yearLower === 'inconsistent') {
                query.year_range = { $not: /\d{4}/ };
            } else if (/^\d{4}$/.test(year)) {
                // If it's a 4-digit year, match anything containing it
                query.year_range = { $regex: year, $options: 'i' };
            } else {
                query.year_range = year;
            }
        }

        // Status filter
        if (status === 'pending') {
            query.isApproved = false;
        } else if (status === 'approved') {
            query.isApproved = true;
        }

        // Sort logic
        let sortOption = { createdAt: -1 };
        if (sort === 'oldest') sortOption = { createdAt: 1 };
        else if (sort === 'title_asc') sortOption = { title: 1 };
        else if (sort === 'title_desc') sortOption = { title: -1 };

        const [theses, total] = await Promise.all([
            Thesis.find(query)
                .sort(sortOption)
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

// @route   GET /admin/years
// @desc    Get all distinct years in the DB (including unapproved)
router.get('/years', async (req, res) => {
    try {
        const years = await Thesis.distinct('year_range');
        // Extract 4-digit years from strings like "September 2024"
        const yearSet = new Set();
        years.forEach(y => {
            if (y && typeof y === 'string') {
                const match = y.match(/\d{4}/);
                if (match) yearSet.add(match[0]);
                else if (y.toLowerCase() === 'unknown') yearSet.add('unknown');
            }
        });
        const sortedYears = Array.from(yearSet).sort().reverse();
        res.json(sortedYears);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching years', error: err.message });
    }
});

// @route   GET /admin/courses
// @desc    Get all distinct courses in the DB (including unapproved)
router.get('/courses', async (req, res) => {
    try {
        const courses = await Thesis.distinct('course');
        const sortedCourses = courses.filter(c => c && c.toLowerCase() !== 'general').sort();
        res.json(sortedCourses);
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error fetching courses', error: err.message });
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
        const thesis = await Thesis.findById(req.params.id);
        if (!thesis) return res.status(404).json({ success: false, message: 'Thesis not found' });

        // Cleanup Cloudinary attachments
        if (thesis.attachments && thesis.attachments.length > 0) {
            try {
                const deletePromises = thesis.attachments.map(url => {
                    // Extract public_id from Cloudinary URL
                    // Example: https://res.cloudinary.com/v1_1/cloudname/image/upload/v12345/folder/public_id.jpg
                    const parts = url.split('/');
                    const filenameWithExt = parts[parts.length - 1];
                    const publicIdWithoutExt = filenameWithExt.split('.')[0];

                    // The folder path is also part of the public_id if used
                    // For this project, they are in folder/public_id
                    const folderName = parts[parts.length - 2];
                    const fullPublicId = `${process.env.CLOUDINARY_FOLDER_NAME}/submissions/${publicIdWithoutExt}`;

                    return cloudinary.uploader.destroy(fullPublicId);
                });
                await Promise.all(deletePromises);
            } catch (err) {
                console.error('Cloudinary cleanup error:', err);
                // Continue with DB deletion even if Cloudinary fails
            }
        }

        // Now delete from DB
        await Thesis.findByIdAndDelete(req.params.id);

        // Cascade delete: Remove associated collaborations and session history
        await Promise.all([
            Collaboration.deleteMany({ thesis: req.params.id }),
            SessionHistory.deleteMany({ thesis: req.params.id })
        ]);

        await invalidateSearchCache();

        res.json({ success: true, message: 'Thesis and associated attachments deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting thesis', error: err.message });
    }
});

// @route   PATCH /admin/theses/:id/approve
// @desc    Approve a thesis
router.patch('/theses/:id/approve', async (req, res) => {
    try {
        const thesis = await Thesis.findById(req.params.id);

        if (!thesis) return res.status(404).json({ success: false, message: 'Thesis not found' });

        // Enforce Multi-Step Approval: Must be approved by Faculty first
        if (!thesis.isProfApproved) {
            return res.status(400).json({
                success: false,
                message: 'This document cannot be approved by the Admin yet. It must first be approved by the assigned Faculty.'
            });
        }

        thesis.isApproved = true;
        await thesis.save();

        await invalidateSearchCache();

        // === AUTO-PROMOTE STUDENT TO ALUMNI ===
        // When both faculty (isProfApproved) and librarian (isApproved) have approved,
        // the thesis creator is promoted to alumni so they can receive collaboration requests.
        if (thesis.createdBy) {
            try {
                const creator = await User.findById(thesis.createdBy);
                if (creator && !creator.isGraduate && !creator.isProfessor && !creator.isAdmin) {
                    creator.isGraduate = true;
                    await creator.save();
                    console.log(`User ${creator.name} (${creator._id}) promoted to Alumni after full thesis approval.`);
                }
            } catch (promoteErr) {
                console.error('Failed to promote user to alumni:', promoteErr);
            }
        }

        // Notify student of Librarian/Admin approval + alumni promotion
        if (thesis.createdBy) {
            try {
                const Notification = require('../models/Notifcation');
                const notif = new Notification({
                    recipient: thesis.createdBy,
                    sender: req.user,
                    title: '🎓 Thesis Fully Approved — Welcome, Alumni!',
                    message: `Congratulations! Your thesis "${thesis.title}" has been approved by both the Faculty and the Librarian. Your account has been upgraded to Alumni status. You can now receive collaboration requests from students.`,
                    type: 'thesis_approved_lib',
                    link: '/documents/submissions'
                });
                await notif.save();
            } catch (notifErr) {
                console.error('Failed to create lib approval notification:', notifErr);
            }
        }

        res.json({ success: true, message: 'Thesis approved successfully and cataloged in the repository.', data: thesis });

    } catch (err) {
        res.status(500).json({ success: false, message: 'Error approving thesis', error: err.message });
    }
});

// @route   PATCH /admin/theses/:id/disapprove
// @desc    Disapprove a thesis
router.patch('/theses/:id/disapprove', async (req, res) => {
    try {
        const thesis = await Thesis.findById(req.params.id);
        if (!thesis) return res.status(404).json({ success: false, message: 'Thesis not found' });

        thesis.isApproved = false;
        thesis.isRejected = true;
        thesis.rejectedByRole = 'librarian';
        thesis.deleteAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days from now
        await thesis.save();

        await invalidateSearchCache();

        // Notify student of Librarian/Admin disapproval
        if (thesis.createdBy) {
            try {
                const Notification = require('../models/Notifcation');
                const notif = new Notification({
                    recipient: thesis.createdBy,
                    sender: req.user,
                    title: 'Thesis Rejected by Librarian',
                    message: `Your thesis "${thesis.title}" has been rejected/disapproved by the Librarian and will be auto-deleted in 5 days if not resubmitted.`,
                    type: 'thesis_rejected_lib',
                    link: '/documents/submissions'
                });
                await notif.save();
            } catch (notifErr) {
                console.error('Failed to create lib disapproval notification:', notifErr);
            }
        }

        res.json({ success: true, message: 'Thesis disapproved successfully', data: thesis });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error disapproving thesis', error: err.message });
    }
});

// @route   GET /admin/collaborations
// @desc    Get all collaboration requests
router.get('/collaborations', async (req, res) => {
    try {
        const collaborations = await Collaboration.find()
            .populate('alumni', 'name idNumber profilePhoto')
            .populate('undergrad', 'name idNumber profilePhoto')
            .populate('thesis', 'title')
            .sort({ createdAt: -1 });

        res.json({ success: true, data: collaborations });
    } catch (err) {
        console.error('Fetch collaborations error:', err);
        res.status(500).json({ success: false, message: 'Error fetching collaborations', error: err.message });
    }
});

module.exports = router;
