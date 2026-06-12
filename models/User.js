const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        maxlength: [100, 'Name cannot exceed 100 characters']
    },
    idNumber: {
        type: String,
        required: [true, 'ID number is required'],
        unique: true,
        trim: true,
        maxlength: [50, 'ID number cannot exceed 50 characters']
    },
    birthdate: {
        type: Date,
        required: false,
        validate: {
            validator: function (value) {
                // Only validate if birthdate is provided
                if (!value) return true;
                const today = new Date();
                const minAgeDate = new Date();
                minAgeDate.setFullYear(today.getFullYear() - 18);
                return value <= minAgeDate;
            },
            message: 'You must be at least 18 years old to register'
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters long']
    },
    secretQuestion: {
        type: String,
        default: null
    },
    secretAnswer: {
        type: String,
        default: null
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    isGraduate: {
        type: Boolean,
        default: false
    },
    isProfessor: {
        type: Boolean,
        default: false
    },
    profilePhoto: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password') && !this.isModified('secretAnswer')) return next();

    try {
        const salt = await bcrypt.genSalt(12);

        if (this.isModified('password')) {
            this.password = await bcrypt.hash(this.password, salt);
        }

        // Hash secret answer if it was modified and is non-null
        if (this.isModified('secretAnswer') && this.secretAnswer) {
            this.secretAnswer = await bcrypt.hash(this.secretAnswer, salt);
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    try {
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        throw new Error('Password comparison failed');
    }
};

// Compare secret answer method
userSchema.methods.compareSecretAnswer = async function (candidateAnswer) {
    try {
        if (!this.secretAnswer) return false;
        return await bcrypt.compare(candidateAnswer, this.secretAnswer);
    } catch (error) {
        throw new Error('Secret answer comparison failed');
    }
};

// Transform output to include virtuals and remove sensitive fields
userSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.password;
        delete ret.secretAnswer;
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('User', userSchema);