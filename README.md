# TUPT Thesis Archive - Node.js Backend

The robust, AI-powered backend engine for the Technological University of the Philippines Taguig Thesis Archive. This server handles security, document processing, and the intelligent search infrastructure for both web and mobile platforms.

**🔗 Repository:** [https://github.com/gericandmorty/TUPT-Thesis_ArchiveNodeBackend](https://github.com/gericandmorty/TUPT-Thesis_ArchiveNodeBackend)

---

## 🛠️ Core Capabilities

- **AI-Powered Analysis**: Integrated with **Google Gemini AI** for automatic thesis title generation, structural suggestions, and abstract summarization.
- **Smart Document Processing**: Robust PDF/DOCX parsing (using `pdf-parse` and `mammoth`) to extract metadata instantly upon upload.
- **Institutional Security**: Secure authentication flow using **JWT** (JSON Web Tokens) and **Bcryptjs** for password hashing.
- **Semantic Search API**: High-performance search endpoints catering to thousands of indexed research records.
- **Cloud Media Management**: Integrated with **Cloudinary** for scalable and secure document/image storage.
- **Role-Based Access Control**: Granular permissions for Students, Faculty, and Admin users.

---

## 🚀 Technical Stack

- **Runtime**: Node.js (LTS)
- **Framework**: Express.js
- **Database**: MongoDB (via Mongoose ODM)
- **Caching**: Redis (Upstash)
- **AI Integration**: Google Generative AI SDK (@google/generative-ai)
- **File Handling**: Multer & Multer-Storage-Cloudinary

---

## 📋 Prerequisites

- **Node.js**: v18.x or later.
- **MongoDB**: A local instance or MongoDB Atlas cluster.
- **Environment Keys**: You will need Gemini AI and Cloudinary API keys.

---

## ⚙️ Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/gericandmorty/TUPT-Thesis_ArchiveNodeBackend.git
cd backend
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory and configure the following variables:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_secure_jwt_secret
CLOUDINARY_CLOUD_NAME=your_name
CLOUDINARY_API_KEY=your_key
CLOUDINARY_API_SECRET=your_secret
GEMINI_API_KEY=your_google_ai_key
```

### 4. Start the Server
```bash
# Development mode with watch
npm run dev

# Production mode
npm start
```
The server will be reachable at `http://localhost:5000`.

---

## 📂 Architecture Overview

- `/routes`: Modular API endpoints (Auth, User, Thesis, Admin).
- `/models`: Mongoose schemas for Users, Theses, and Archives.
- `/modules`: Core logic engines for AI analysis and document parsing.
- `/middleware`: Authentication guards and request validation.
- `/db`: Database connection configuration.

---

## 🤝 Institutional Note

This backend project is developed as part of an institutional modernization effort for **TUP Taguig**. Contributions are restricted to authorized project members.
