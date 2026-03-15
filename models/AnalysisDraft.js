const mongoose = require('mongoose');

const analysisDraftSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    originalResults: {
        type: Object, // The full result object from analyzeDocument
        required: true
    },
    localPagesText: [{
        pageNumber: Number,
        text: String
    }],
    appliedIssueIds: [String],
    lastSaved: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

const AnalysisDraft = mongoose.model('AnalysisDraft', analysisDraftSchema);

module.exports = AnalysisDraft;
