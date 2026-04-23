const User = require('../models/User');

const professor = async (req, res, next) => {
    try {
        // req.user is set by the 'auth' middleware
        const user = await User.findById(req.user);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Allow both Admins and Professors
        if (!user.isProfessor && !user.isAdmin) {
            return res.status(403).json({ message: 'Access denied. Professor or Administrator privileges required.' });
        }

        next();
    } catch (err) {
        res.status(500).json({ message: 'Server error during professor verification', error: err.message });
    }
};

module.exports = professor;
