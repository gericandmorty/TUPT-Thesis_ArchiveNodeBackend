const mongoose = require('mongoose');

const collaborationSchema = new mongoose.Schema({
    alumni: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    undergrad: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    thesis: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Thesis',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'declined'],
        default: 'pending'
    },
    adminStatus: {
        type: String,
        enum: ['pending', 'approved', 'declined'],
        default: 'pending'
    },
    message: {
        type: String,
        required: true,
        trim: true
    },
    followUpMessage: {
        type: String,
        default: null,
        trim: true
    }
}, {
    timestamps: true
});

const Collaboration = mongoose.model('Collaboration', collaborationSchema);

module.exports = Collaboration;
