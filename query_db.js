const path = require('path');
require('dotenv').config();

const connectDB = require('./db/connection');
const User = require('./models/User');
const Thesis = require('./models/Thesis');

async function run() {
    await connectDB();
    
    console.log("=== USERS ===");
    const users = await User.find({}, 'name idNumber isAdmin isGraduate isProfessor');
    console.log(JSON.stringify(users, null, 2));

    console.log("=== SPECIFIC THESIS ===");
    const thesis = await Thesis.findOne({ title: "Machine based Egg" }).populate('createdBy');
    console.log(JSON.stringify(thesis, null, 2));

    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
