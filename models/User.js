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
        required: [true, 'Birthdate is required'],
        validate: {
            validator: function (value) {
                // Check if birthdate is not in the future
                return value <= new Date();
            },
            message: 'Birthdate cannot be in the future'
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters long']
    },
    isAdmin: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true // Adds createdAt and updatedAt automatically
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    // Only hash the password if it's modified (or new)
    if (!this.isModified('password')) return next();

    try {
        // Generate salt
        const salt = await bcrypt.genSalt(12);
        // Hash password
        this.password = await bcrypt.hash(this.password, salt);
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

// Virtual for age calculation
userSchema.virtual('age').get(function () {
    if (!this.birthdate) return null;

    const today = new Date();
    const birthDate = new Date(this.birthdate);
    let age = today.getFullYear() - birthDate.getFullYear();

    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }

    return age;
});

// Transform output to include virtuals and remove password
userSchema.set('toJSON', {
    virtuals: true,
    transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('User', userSchema);