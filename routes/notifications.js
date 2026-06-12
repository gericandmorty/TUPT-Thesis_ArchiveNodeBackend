const express = require('express');
const router = express.Router();
const Notification = require('../models/Notifcation');
const auth = require('../middleware/auth');

// @route   GET /notifications
// @desc    Get all notifications for logged-in user
router.get('/', auth, async (req, res) => {
    try {
        const notifications = await Notification.find({ recipient: req.user })
            .populate('sender', 'name profilePhoto isGraduate isProfessor')
            .sort({ createdAt: -1 });
        res.json({ success: true, data: notifications });
    } catch (err) {
        console.error('Fetch notifications error:', err);
        res.status(500).json({ success: false, message: 'Error fetching notifications', error: err.message });
    }
});

// @route   PATCH /notifications/read-all
// @desc    Mark all notifications as read for logged-in user
router.patch('/read-all', auth, async (req, res) => {
    try {
        await Notification.updateMany(
            { recipient: req.user, isRead: false },
            { $set: { isRead: true } }
        );
        res.json({ success: true, message: 'All notifications marked as read' });
    } catch (err) {
        console.error('Mark all read error:', err);
        res.status(500).json({ success: false, message: 'Error updating notifications', error: err.message });
    }
});

// @route   PATCH /notifications/:id/read
// @desc    Mark a single notification as read
router.patch('/:id/read', auth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipient: req.user },
            { $set: { isRead: true } },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({ success: true, data: notification });
    } catch (err) {
        console.error('Mark read error:', err);
        res.status(500).json({ success: false, message: 'Error updating notification', error: err.message });
    }
});

// @route   DELETE /notifications/:id
// @desc    Delete a single notification
router.delete('/:id', auth, async (req, res) => {
    try {
        const notification = await Notification.findOneAndDelete({
            _id: req.params.id,
            recipient: req.user
        });

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.json({ success: true, message: 'Notification deleted successfully' });
    } catch (err) {
        console.error('Delete notification error:', err);
        res.status(500).json({ success: false, message: 'Error deleting notification', error: err.message });
    }
});

// @route   DELETE /notifications
// @desc    Clear all notifications for logged-in user
router.delete('/', auth, async (req, res) => {
    try {
        await Notification.deleteMany({ recipient: req.user });
        res.json({ success: true, message: 'All notifications cleared' });
    } catch (err) {
        console.error('Clear all notifications error:', err);
        res.status(500).json({ success: false, message: 'Error clearing notifications', error: err.message });
    }
});

module.exports = router;
