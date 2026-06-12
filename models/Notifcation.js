const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    title: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: [
            'thesis_assigned',
            'collaboration_request',
            'thesis_approved_prof',
            'thesis_approved_prof_notify_admin',
            'thesis_rejected_prof',
            'thesis_approved_lib',
            'thesis_rejected_lib',
            'collaboration_accepted',
            'collaboration_declined'
        ],
        required: true
    },
    isRead: {
        type: Boolean,
        default: false
    },
    link: {
        type: String
    }
}, {
    timestamps: true,
    collection: 'notifications' // Explicit collection name in case of spelling differences
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
