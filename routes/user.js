const express = require('express');
const User = require('../models/User');
const router = express.Router();
const auth = require('../middleware/auth');


router.get('/profile', auth, async (req, res) => {
    try {

        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching user profile',
            error: error.message
        });
    }
});


router.put('/profile', auth, async (req, res) => {
    try {
        const { userId, name, birthdate, currentPassword, newPassword } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update name if provided
        if (name) {
            user.name = name;
        }

        // Update birthdate if provided
        if (birthdate) {
            const newBirthdate = new Date(birthdate);
            if (newBirthdate > new Date()) {
                return res.status(400).json({
                    success: false,
                    message: 'Birthdate cannot be in the future'
                });
            }
            user.birthdate = newBirthdate;
        }

        // Update password if provided
        if (newPassword) {
            if (!currentPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is required to set new password'
                });
            }

            // Verify current password
            const isCurrentPasswordValid = await user.comparePassword(currentPassword);
            if (!isCurrentPasswordValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Current password is incorrect'
                });
            }

            // Check if new password meets requirements
            if (newPassword.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters long'
                });
            }

            user.password = newPassword;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: user
            }
        });

    } catch (error) {
        console.error('Update profile error:', error);

        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'User with this ID number already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Error updating profile',
            error: error.message
        });
    }
});

module.exports = router;