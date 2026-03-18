const express = require('express');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const User = require('../models/User');
const Thesis = require('../models/Thesis');
const AiHistory = require('../models/AiHistory');
const LocalComparison = require('../models/LocalComparison');
const AnalysisDraft = require('../models/AnalysisDraft');
const router = express.Router();
const auth = require('../middleware/auth');
const multer = require('multer');
const { analyzeDocument, findSimilarity } = require('../modules/documentAnalyzer');
const { invalidateSearchCache } = require('../modules/cache');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_ID,
    api_key: process.env.CLOUDINARY_API,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer configuration for file analysis (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Cloudinary storage configuration
const profileStorage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'profilePictures_capstone2',
        allowed_formats: ['jpg', 'png', 'jpeg'],
        transformation: [{ width: 500, height: 500, crop: 'limit' }]
    }
});

const profileUpload = multer({
    storage: profileStorage,
    limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

// @route   POST /user/theses
// @desc    Submit a new thesis
router.post('/theses', auth, async (req, res) => {
    try {
        const { title, abstract, author, year_range, category, id } = req.body;

        const newThesis = new Thesis({
            id: id || `USER-${Date.now()}`, // Fallback ID if not provided
            title,
            abstract,
            author,
            year_range,
            category,
            createdBy: req.user,
            isApproved: false // Always false by default for user submissions
        });

        const thesis = await newThesis.save();

        // Invalidate public search cache
        await invalidateSearchCache();

        res.status(201).json({ success: true, data: thesis });
    } catch (err) {
        console.error('Submission error:', err);
        res.status(500).json({ success: false, message: 'Error submitting thesis', error: err.message });
    }
});

// @route   GET /user/theses
// @desc    Get all theses created by the logged-in user
router.get('/theses', auth, async (req, res) => {
    try {
        const theses = await Thesis.find({ createdBy: req.user }).sort({ createdAt: -1 });
        res.json({ success: true, data: theses });
    } catch (err) {
        console.error('Fetch error:', err);
        res.status(500).json({ success: false, message: 'Error fetching your theses', error: err.message });
    }
});

// @route   PUT /user/theses/:id
// @desc    Update a thesis created by the logged-in user
router.put('/theses/:id', auth, async (req, res) => {
    try {
        const { title, abstract, author, year_range, category } = req.body;
        
        let thesis = await Thesis.findOne({ _id: req.params.id, createdBy: req.user });

        if (!thesis) {
            return res.status(404).json({ success: false, message: 'Thesis not found or unauthorized' });
        }

        // Update fields
        if (title) thesis.title = title;
        if (abstract) thesis.abstract = abstract;
        if (author) thesis.author = author;
        if (year_range) thesis.year_range = year_range;
        if (category) thesis.category = category;
        
        // Reset approval status on edit to require re-review
        thesis.isApproved = false;

        await thesis.save();
        
        // Invalidate public search cache
        await invalidateSearchCache();

        res.json({ success: true, data: thesis });
    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ success: false, message: 'Error updating thesis', error: err.message });
    }
});

// @route   DELETE /user/theses/:id
// @desc    Delete a thesis created by the logged-in user
router.delete('/theses/:id', auth, async (req, res) => {
    try {
        const thesis = await Thesis.findOne({ _id: req.params.id, createdBy: req.user });

        if (!thesis) {
            return res.status(404).json({ success: false, message: 'Thesis not found or unauthorized' });
        }

        await thesis.deleteOne();
        
        // Invalidate public search cache
        await invalidateSearchCache();

        res.json({ success: true, message: 'Thesis deleted successfully' });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ success: false, message: 'Error deleting thesis', error: err.message });
    }
});


router.get('/profile', auth, async (req, res) => {
    try {

        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user profile',
            error: error.message
        });
    }
});


router.put('/profile', auth, async (req, res) => {
    try {
        const { userId, name, birthdate, currentPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update name if provided
        if (name) {
            user.name = name;
        }

        // Update birthdate if provided
        if (birthdate) {
            const newBirthdate = new Date(birthdate);
            if (newBirthdate > new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Birthdate cannot be in the future'
                });
            }
            user.birthdate = newBirthdate;
        }

        // Update password if provided
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is required to set new password'
                });
            }

            // Verify current password
            const isCurrentPasswordValid = await user.comparePassword(currentPassword);
            if (!isCurrentPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Check if new password meets requirements
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters long'
                });
            }

            user.password = newPassword;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'User with this ID number already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

// @route   POST /user/analyze
// @desc    Analyze a research document
router.post('/analyze', auth, upload.single('thesis'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        const stats = await analyzeDocument(req.file.buffer, req.file.mimetype);

        // --- Similarity Analysis ---
        const allTheses = await Thesis.find({}).select('title abstract id');
        
        // Refined extraction: Filter empty lines and find potential title (longest of first 5 non-empty lines)
        const firstLines = (stats.pagesText[0]?.text || "").split('\n').map(l => l.trim()).filter(l => l.length > 5).slice(0, 10);
        let predictedTitle = "Untitled Document";
        if (firstLines.length > 0) {
            predictedTitle = firstLines.reduce((a, b) => a.length > b.length ? a : b);
        }
        
        const predictedAbstract = stats.pagesText.map(p => p.text).join(' ').substring(0, 10000);

        const similarity = await findSimilarity(predictedTitle, predictedAbstract, allTheses);

        res.json({
            success: true,
            ...stats,
            similarity
        });

    } catch (err) {
        console.error('Analysis error:', err);
        res.status(500).json({
            success: false,
            message: 'Error analyzing document',
            error: err.message
        });
    }
});

// @route   GET /user/ai-history
// @desc    Get all AI prompt history for the logged-in user
router.get('/ai-history', auth, async (req, res) => {
    try {
        const history = await AiHistory.find({ user: req.user }).sort({ createdAt: -1 });
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('Fetch AI history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching AI history', error: err.message });
    }
});

// @route   DELETE /user/ai-history/:id
// @desc    Delete a specific AI prompt history
router.delete('/ai-history/:id', auth, async (req, res) => {
    try {
        const history = await AiHistory.findOne({ _id: req.params.id, user: req.user });

        if (!history) {
            return res.status(404).json({ success: false, message: 'History record not found or unauthorized' });
        }

        await history.deleteOne();
        res.json({ success: true, message: 'History record deleted' });
    } catch (err) {
        console.error('Delete AI history error:', err);
        res.status(500).json({ success: false, message: 'Error deleting AI history', error: err.message });
    }
});

// @route   DELETE /user/ai-history
// @desc    Clear all AI prompt history for the user
router.delete('/ai-history', auth, async (req, res) => {
    try {
        await AiHistory.deleteMany({ user: req.user });
        res.json({ success: true, message: 'All history records deleted' });
    } catch (err) {
        console.error('Clear AI history error:', err);
        res.status(500).json({ success: false, message: 'Error clearing AI history', error: err.message });
    }
});

// @route   POST /user/analysis-drafts
// @desc    Save or update a document analysis draft
router.post('/analysis-drafts', auth, async (req, res) => {
    try {
        const { fileName, originalResults, localPagesText, appliedIssueIds } = req.body;
        
        if (!fileName) {
            return res.status(400).json({ success: false, message: 'Filename is required' });
        }

        // Find existing draft for this user and file
        let draft = await AnalysisDraft.findOne({ user: req.user, fileName });
        
        if (draft) {
            draft.originalResults = originalResults;
            draft.localPagesText = localPagesText;
            draft.appliedIssueIds = appliedIssueIds;
            draft.lastSaved = Date.now();
            await draft.save();
        } else {
            draft = new AnalysisDraft({
                user: req.user,
                fileName,
                originalResults,
                localPagesText,
                appliedIssueIds
            });
            await draft.save();
        }
        
        res.json({ success: true, message: 'Draft saved successfully', data: draft });
    } catch (err) {
        console.error('Save draft error:', err);
        res.status(500).json({ success: false, message: 'Error saving draft', error: err.message });
    }
});

// @route   GET /user/analysis-drafts
// @desc    Get all analysis drafts for the logged-in user
router.get('/analysis-drafts', auth, async (req, res) => {
    try {
        const drafts = await AnalysisDraft.find({ user: req.user }).sort({ lastSaved: -1 });
        res.json({ success: true, data: drafts });
    } catch (err) {
        console.error('Fetch drafts error:', err);
        res.status(500).json({ success: false, message: 'Error fetching drafts', error: err.message });
    }
});

// @route   POST /user/profile-photo
// @desc    Upload profile photo
router.post('/profile-photo', auth, profileUpload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Please upload a photo' });
        }

        const filePath = req.file.path; // Cloudinary returns the full URL in path
        
        // Find existing user to check for old photo
        const currentUser = await User.findById(req.user);
        
        if (currentUser && currentUser.profilePhoto && currentUser.profilePhoto.includes('cloudinary.com')) {
            try {
                // Extract public_id from URL
                // Format: https://res.cloudinary.com/cloud_name/image/upload/v12345/folder/id.jpg
                const urlParts = currentUser.profilePhoto.split('/');
                const uploadIndex = urlParts.findIndex(part => part === 'upload');
                
                if (uploadIndex !== -1) {
                    // Parts after version (v...) are the public_id
                    const publicIdWithExt = urlParts.slice(uploadIndex + 2).join('/');
                    const publicId = publicIdWithExt.split('.')[0];
                    
                    if (publicId) {
                        await cloudinary.uploader.destroy(publicId);
                        console.log('Deleted old profile photo:', publicId);
                    }
                }
            } catch (deleteErr) {
                // Log but don't fail the update if deletion fails
                console.error('Failed to delete old photo from Cloudinary:', deleteErr);
            }
        }

        // Update user profile with photo path
        const user = await User.findByIdAndUpdate(
            req.user,
            { profilePhoto: filePath },
            { new: true }
        );

        res.json({
            success: true,
            message: 'Profile photo updated successfully',
            data: {
                profilePhoto: filePath,
                user
            }
        });
    } catch (err) {
        console.error('Photo upload error:', err);
        res.status(500).json({ success: false, message: 'Error uploading photo', error: err.message });
    }
});

// @route   GET /user/analysis-drafts/:fileName
// @desc    Get a specific analysis draft
router.get('/analysis-drafts/:fileName', auth, async (req, res) => {
    try {
        const draft = await AnalysisDraft.findOne({ user: req.user, fileName: req.params.fileName });
        res.json({ success: true, data: draft });
    } catch (err) {
        console.error('Fetch draft error:', err);
        res.status(500).json({ success: false, message: 'Error fetching draft', error: err.message });
    }
});

// @route   POST /user/ai-history
// @desc    Save a new AI prompt/recommendation
router.post('/ai-history', auth, async (req, res) => {
    try {
        const { prompt, recommendation } = req.body;

        if (!prompt || !recommendation) {
            return res.status(400).json({ success: false, message: 'Prompt and recommendation required' });
        }

        const newHistory = new AiHistory({
            user: req.user,
            prompt,
            recommendation
        });

        await newHistory.save();
        res.status(201).json({ success: true, data: newHistory });
    } catch (err) {
        console.error('Save AI history error:', err);
        res.status(500).json({ success: false, message: 'Error saving AI history', error: err.message });
    }
});

// @route   GET /user/local-history
// @desc    Get all local title comparison history for the user
router.get('/local-history', auth, async (req, res) => {
    try {
        const history = await LocalComparison.find({ user: req.user }).sort({ createdAt: -1 });
        res.json({ success: true, data: history });
    } catch (err) {
        console.error('Fetch local history error:', err);
        res.status(500).json({ success: false, message: 'Error fetching local history', error: err.message });
    }
});

// @route   DELETE /user/local-history/:id
// @desc    Delete a specific local comparison history record
router.delete('/local-history/:id', auth, async (req, res) => {
    try {
        const history = await LocalComparison.findOne({ _id: req.params.id, user: req.user });
        if (!history) {
            return res.status(404).json({ success: false, message: 'Record not found' });
        }
        await history.deleteOne();
        res.json({ success: true, message: 'Record deleted' });
    } catch (err) {
        console.error('Delete local history error:', err);
        res.status(500).json({ success: false, message: 'Error deleting record', error: err.message });
    }
});

// @route   DELETE /user/local-history
// @desc    Clear all local comparison history for the user
router.delete('/local-history', auth, async (req, res) => {
    try {
        await LocalComparison.deleteMany({ user: req.user });
        res.json({ success: true, message: 'All local history records deleted' });
    } catch (err) {
        console.error('Clear local history error:', err);
        res.status(500).json({ success: false, message: 'Error clearing local history', error: err.message });
    }
});

module.exports = router;