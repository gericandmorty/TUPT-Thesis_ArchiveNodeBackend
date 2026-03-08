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
    category: {
        type: String,
        default: 'General'
    },
    isApproved: {
        type: Boolean,
        default: false
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
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
