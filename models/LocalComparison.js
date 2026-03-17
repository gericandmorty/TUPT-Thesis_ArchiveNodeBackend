const mongoose = require('mongoose');

const localComparisonSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    searchQuery: {
        type: String,
        required: true
    },
    similarityScore: {
        type: Number,
        required: true
    },
    matchedTitle: {
        type: String
    },
    matchedId: {
        type: String
    },
    recommendation: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('LocalComparison', localComparisonSchema);
