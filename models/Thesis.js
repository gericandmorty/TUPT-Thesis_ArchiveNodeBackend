const mongoose = require('mongoose');

const thesisSchema = new mongoose.Schema({
    id: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    title: {
        type: String,
        required: true
    },
    abstract: {
        type: String,
        required: true
    },
    author: {
        type: String,
        default: 'Academic Research Group'
    },
    year_range: {
        type: String,
        default: 'unknown'
    },
    filename: {
        type: String
    },
    source: {
        type: String,
        default: 'ocr'
    },
    word_count: {
        type: Number
    },
    course: {
        type: String,
        default: 'General'
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    isProfApproved: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    professorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    attachments: [{
        type: String // Cloudinary URLs for supporting documents
    }]
}, {
    timestamps: true
});

// Add text indexes for weighted search
thesisSchema.index({
    title: 'text',
    author: 'text',
    abstract: 'text'
}, {
    weights: {
        title: 10,
        author: 5,
        abstract: 2
    },
    name: "ThesisSearchIndex"
});

const Thesis = mongoose.model('Thesis', thesisSchema);

module.exports = Thesis;
