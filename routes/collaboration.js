const express = require('express');
const router = express.Router();
const Collaboration = require('../models/Collaboration');
const Thesis = require('../models/Thesis');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');

// @route   POST /collaboration
// @desc    Create a new collaboration request
router.post('/', auth, async (req, res) => {
    try {
        const { thesisId, message } = req.body;

        if (!thesisId || !message) {
            return res.status(400).json({ success: false, message: 'Thesis ID and message are required' });
        }

        const thesis = await Thesis.findById(thesisId).populate('createdBy');
        if (!thesis) {
            return res.status(404).json({ success: false, message: 'Thesis not found' });
        }

        // Check if the requester is the owner
        if (thesis.createdBy._id.toString() === req.user.toString()) {
            return res.status(400).json({ success: false, message: 'You cannot request collaboration on your own thesis' });
        }

        // Check if a request already exists
        const existingRequest = await Collaboration.findOne({
            alumni: req.user,
            thesis: thesisId
        });

        if (existingRequest) {
            return res.status(400).json({ success: false, message: 'Collaboration request already sent for this thesis' });
        }

        const newCollaboration = new Collaboration({
            alumni: req.user,
            undergrad: thesis.createdBy._id,
            thesis: thesisId,
            message
        });

        await newCollaboration.save();

        // Notify the recipient immediately (Pending Admin Approval)
        try {
            const User = require('../models/User');
            const Notification = require('../models/Notifcation');
            const senderUser = await User.findById(req.user);
            
            const notif = new Notification({
                recipient: thesis.createdBy._id,
                sender: req.user,
                title: 'Collaboration Request Received (Pending Approval)',
                message: `${senderUser ? senderUser.name : 'A student'} has requested to collaborate on your thesis "${thesis.title}". This request is currently pending administrator review.`,
                type: 'collaboration_request',
                link: '/collaboration'
            });
            await notif.save();
            console.log(`[Notification] Created pending collaboration request notification for recipient: ${thesis.createdBy._id}`);
        } catch (notifErr) {
            console.error('Failed to create pending collaboration notification:', notifErr);
        }

        res.status(201).json({ success: true, data: newCollaboration });

    } catch (err) {
        console.error('Collaboration request error:', err);
        res.status(500).json({ success: false, message: 'Error creating collaboration request', error: err.message });
    }
});

// @route   GET /collaboration/my-requests
// @desc    Get requests made by the current user (Alumni)
router.get('/my-requests', auth, async (req, res) => {
    try {
        const requests = await Collaboration.find({ alumni: req.user })
            .populate('thesis', 'title id')
            .populate('undergrad', 'name profilePhoto isGraduate')
            .populate('alumni', 'name profilePhoto isGraduate')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, data: requests });
    } catch (err) {
        console.error('Fetch requests error:', err);
        res.status(500).json({ success: false, message: 'Error fetching requests', error: err.message });
    }
});

// @route   GET /collaboration/incoming
// @desc    Get requests received by the current user (Undergrad)
router.get('/incoming', auth, async (req, res) => {
    try {
        const requests = await Collaboration.find({ 
            undergrad: req.user,
            adminStatus: 'approved' 
        })
            .populate('thesis', 'title id')
            .populate('alumni', 'name profilePhoto isGraduate')
            .populate('undergrad', 'name profilePhoto isGraduate')
            .sort({ createdAt: -1 });
        
        res.json({ success: true, data: requests });
    } catch (err) {
        console.error('Fetch incoming requests error:', err);
        res.status(500).json({ success: false, message: 'Error fetching incoming requests', error: err.message });
    }
});

// @route   PATCH /collaboration/:id
// @desc    Update request status (Accept/Decline)
router.patch('/:id', auth, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['accepted', 'declined'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const request = await Collaboration.findOne({ _id: req.params.id, undergrad: req.user });
        if (!request) {
            return res.status(404).json({ success: false, message: 'Collaboration request not found or unauthorized' });
        }

        request.status = status;
        await request.save();

        // Notify the alumni (the requester, request.alumni in DB schema) about student's decision
        try {
            const User = require('../models/User');
            const Notification = require('../models/Notifcation');
            const recipientUser = await User.findById(request.undergrad);

            const notif = new Notification({
                recipient: request.alumni,
                sender: request.undergrad,
                title: status === 'accepted' ? 'Collaboration Request Accepted' : 'Collaboration Request Declined',
                message: `${recipientUser ? recipientUser.name : 'The alumni'} has ${status} your collaboration request.`,
                type: status === 'accepted' ? 'collaboration_accepted' : 'collaboration_declined',
                link: '/collaboration'
            });
            await notif.save();
        } catch (notifErr) {
            console.error('Failed to create collaboration response notification:', notifErr);
        }

        res.json({ success: true, data: request });
    } catch (err) {
        console.error('Update request error:', err);
        res.status(500).json({ success: false, message: 'Error updating request', error: err.message });
    }
});

// @route   PATCH /collaboration/:id/followup
// @desc    Alumni submits follow-up contact/social info after collaboration is accepted
router.patch('/:id/followup', auth, async (req, res) => {
    try {
        const { followUpMessage } = req.body;
        if (!followUpMessage || !followUpMessage.trim()) {
            return res.status(400).json({ success: false, message: 'Follow-up message is required' });
        }

        const request = await Collaboration.findById(req.params.id)
            .populate('alumni')
            .populate('undergrad');

        if (!request) {
            return res.status(404).json({ success: false, message: 'Collaboration request not found' });
        }

        if (request.status !== 'accepted') {
            return res.status(400).json({ success: false, message: 'Can only send follow-up for accepted collaborations' });
        }

        // Identify the roles in the relationship to verify authorized alumni user
        const alumniUser = request.alumni.isGraduate ? request.alumni : (request.undergrad.isGraduate ? request.undergrad : null);
        const studentUser = request.alumni.isGraduate ? request.undergrad : (request.undergrad.isGraduate ? request.alumni : null);

        let isAuthorized = false;
        let recipientId = null;

        if (alumniUser && studentUser) {
            if (alumniUser._id.toString() === req.user.toString()) {
                isAuthorized = true;
                recipientId = studentUser._id;
            }
        } else {
            // Fallback: if neither/both is graduate, let the thesis owner (undergrad field) share contact details
            if (request.undergrad._id.toString() === req.user.toString()) {
                isAuthorized = true;
                recipientId = request.alumni._id;
            }
        }

        if (!isAuthorized) {
            return res.status(403).json({ success: false, message: 'Only the alumni in the collaboration can share contact details' });
        }

        request.followUpMessage = followUpMessage.trim();
        await request.save();

        // Notify the student that the alumni shared their contact info
        try {
            const User = require('../models/User');
            const Notification = require('../models/Notifcation');
            const alumniUserDoc = await User.findById(req.user);

            const notif = new Notification({
                recipient: recipientId,
                sender: req.user,
                title: 'Alumni Shared Contact Info',
                message: `${alumniUserDoc ? alumniUserDoc.name : 'Your collaborator'} has shared their contact details for your accepted collaboration. Check your Collaboration Portal to connect!`,
                type: 'collaboration_accepted',
                link: '/collaboration'
            });
            await notif.save();
        } catch (notifErr) {
            console.error('Failed to create follow-up notification:', notifErr);
        }

        res.json({ success: true, data: request });
    } catch (err) {
        console.error('Follow-up message error:', err);
        res.status(500).json({ success: false, message: 'Error saving follow-up message', error: err.message });
    }
});

// @route   PATCH /collaboration/:id/admin-status
// @desc    Admin update collaboration request status
router.patch('/:id/admin-status', auth, admin, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['approved', 'declined'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const request = await Collaboration.findById(req.params.id).populate('thesis');
        if (!request) {
            return res.status(404).json({ success: false, message: 'Collaboration request not found' });
        }

        request.adminStatus = status;
        await request.save();

        // Notify the alumni (undergrad in DB schema) when admin approves the request
        if (status === 'approved') {
            try {
                const User = require('../models/User');
                const Notification = require('../models/Notifcation');
                const senderUser = await User.findById(request.alumni);
                
                const notif = new Notification({
                    recipient: request.undergrad,
                    sender: request.alumni,
                    title: 'Collaboration Request Approved',
                    message: `The administrator has approved the collaboration request from ${senderUser ? senderUser.name : 'a student'} on the thesis "${request.thesis ? request.thesis.title : 'your thesis'}". You can now accept or decline it.`,
                    type: 'collaboration_request',
                    link: '/collaboration'
                });
                await notif.save();
            } catch (notifErr) {
                console.error('Failed to create collaboration request notification:', notifErr);
            }
        }

        res.json({ success: true, data: request });
    } catch (err) {
        console.error('Admin update request error:', err);
        res.status(500).json({ success: false, message: 'Error updating request', error: err.message });
    }
});

module.exports = router;
