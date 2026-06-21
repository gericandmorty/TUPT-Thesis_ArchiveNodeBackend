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

notificationSchema.post('save', async function (doc) {
    try {
        const User = mongoose.model('User');
        const recipientUser = await User.findById(doc.recipient);
        if (recipientUser && recipientUser.expoPushToken) {
            console.log(`[Push Notification] Sending notification to user: ${recipientUser.name} with token: ${recipientUser.expoPushToken}`);
            const response = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Accept-Encoding': 'gzip, deflate',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: recipientUser.expoPushToken,
                    sound: 'default',
                    title: doc.title,
                    body: doc.message,
                    data: { link: doc.link },
                }),
            });
            const resData = await response.json();
            console.log('[Push Notification] Expo response:', resData);
        }
    } catch (err) {
        console.error('[Push Notification] Error sending post-save push:', err);
    }
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
