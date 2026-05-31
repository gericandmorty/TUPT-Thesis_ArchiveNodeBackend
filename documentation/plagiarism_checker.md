# Hybrid Plagiarism & Similarity Checker Documentation

This document describes the technical architecture, mathematical concepts, and usage instructions of the **Hybrid Plagiarism Checker** module (`plagiarismChecker.js`) implemented in the Node.js backend.

The plagiarism checker is built with a **three-tier detection model** that evaluates documents against both **local institutional archives (MongoDB)** and the **public web**, performing lexical, grammatical, and semantic analyses completely in Node.js without requiring external Python subprocesses.

---

## Architectural Overview

The plagiarism checker operates in a hybrid fashion, combining **lexical (word-level) matching** with **semantic (meaning-level) matching** and **real-time web queries**:

```mermaid
graph TD
    A[Uploaded Document] --> B[Text Normalization]
    
    subgraph Layer 1: Local Institutional Check (40% Weight)
        B --> C[TF-IDF Vectorizer]
        B --> D[3-Word Shingling]
        C --> E[Cosine Similarity]
        D --> F[Jaccard & Containment Scores]
        E & F --> G[Lexical Candidate Retrieval]
        G -->|Top 3 Matches| H[SentenceTransformer Embedding Rerank]
    end
    
    subgraph Layer 2: Public Web Check (60% Weight)
        B --> I[Extract 8 Unique Sentences]
        I -->|Quoted phrase queries| J[DuckDuckGo Lite Scraper]
        J --> K[HTML Result Snippet Parsing]
        K --> L[Word Overlap Similarity Threshold]
    end
    
    H & L --> M[Weighted Score Aggregation]
    M --> N[Risk Verdict Resolution]
```

---

## Layer 1: Local Corpus Checker (Lexical & Semantic)

The local check compares the uploaded document against all approved theses stored in the database. To optimize performance and memory, it uses a **Retrieve-and-Rerank** pipeline.

### Step A: Lexical Retrieval (TF-IDF & Shingling)
1. **TF-IDF Vectorizer (`TfidfVectorizer`):**
   * Normalizes and splits text into word tokens (filtering out punctuation and short tokens of length $<3$).
   * Fits a term-frequency matrix across the entire local corpus + query document.
   * Computes smoothed **Inverse Document Frequency (IDF)** for each word:
     $$\text{IDF}(t) = \ln\left(\frac{N}{\text{DF}(t) + 1}\right) + 1$$
     Where $N$ is the total document count and $\text{DF}(t)$ is the document frequency of term $t$.
   * Transforms documents into sparse numerical frequency vectors.

2. **Cosine Similarity:**
   * Compares the query document's TF-IDF vector ($A$) against each local thesis vector ($B$):
     $$\text{Cosine Similarity}(A, B) = \frac{A \cdot B}{\|A\| \|B\|} = \frac{\sum_{i=1}^{n} A_i B_i}{\sqrt{\sum_{i=1}^{n} A_i^2} \sqrt{\sum_{i=1}^{n} B_i^2}}$$

3. **K-Shingling ($k=3$):**
   * Breaks text into overlapping contiguous sequences of 3 words (e.g. `"artificial intelligence research"`).
   * Computes **Jaccard Similarity** (intersection over union) and **Containment Similarity** (intersection over query size):
     $$\text{Jaccard}(A, B) = \frac{|A \cap B|}{|A \cup B|} \qquad \text{Containment}(A, B) = \frac{|A \cap B|}{|A|}$$
   * The shingling metric is highly sensitive to exact string copy-pastes.

4. **Lexical Score Selection:**
   * The lexical score for a candidate is computed as:
     $$\text{Score}_{\text{lexical}} = \max(\text{Cosine Similarity}_{\text{tfidf}}, \text{Similarity}_{\text{shingle}})$$

### Step B: Semantic Reranking (SentenceTransformers)
Lexical search can miss copied sections if the author swaps words with synonyms. To prevent this, the module utilizes **semantic dense vector matching**:
1. **Model Loading:** Uses `@xenova/transformers` (running ONNX-Runtime natively on the CPU) to load `Xenova/all-MiniLM-L6-v2`. This model generates a dense 384-dimensional vector embedding.
2. **Retrieve top candidates:** Only the **top 3 candidates** from the Lexical Retrieval phase are passed to the SentenceTransformer. This prevents heavy CPU loads during database scanning.
3. **Semantic Cosine Similarity:**
   * The system embeds the first 800 characters of the query and the top candidates.
   * It calculates the Cosine Similarity between these dense vectors.
4. **Hybrid Aggregation:**
   * The final local similarity score for each candidate is blended:
     $$\text{Score}_{\text{final}} = (\text{Score}_{\text{lexical}} \times 50\%) + (\text{Score}_{\text{semantic}} \times 50\%)$$

---

## Layer 2: Public Web Checker (DuckDuckGo Lite)

To check the public web without incurring monthly API costs, the system uses a free, automated HTML scraping approach:

1. **Representative Sentence Extraction:**
   * Splitting the document into sentences.
   * Scoring sentences based on length (ideally 12–25 words for query efficiency) and word specificity (removing standard stop words).
   * Selecting **8 representative sentences** spread uniformly throughout the document.

2. **DuckDuckGo Lite Scraper:**
   * Submits each sentence wrapped in double quotes `""` to `https://html.duckduckgo.com/html/` to enforce exact phrase matching.
   * Implements a **600ms rate-limiting pause** between requests to search politely and avoid rate limits.
   * Parses the raw HTML response to extract result links, titles, and snippets.

3. **Snippet Containment Calculation:**
   * Compares the query sentence ($S$) with the search results snippet text ($T$) using word overlap:
     $$\text{Overlap} = \frac{|S \cap T|}{|S|}$$
   * If a snippet shares **$\ge 40\%$** word overlap, it is flagged as a plagiarism match.

---

## Aggregation & Risk Verdicts

The final overall plagiarism score combines both layers:
$$\text{Overall Score} = (\text{Local Score} \times 40\%) + (\text{Web Score} \times 60\%)$$

| Overall Score | Risk Level | Description |
| :--- | :--- | :--- |
| **$\ge$ 50%** | **High Risk** | Significant matching sequences/meanings found in web/local databases. |
| **30% - 49%** | **Medium Risk** | Moderate matches. Often indicates paraphrased copy or poor citation. |
| **15% - 29%** | **Low Risk** | Minor matching text. Normal for typical citation/common phrases. |
| **< 15%** | **Minimal Risk** | Content appears highly original. |

---

## Code Usage

### Import and Run the Analysis

```javascript
const { performPlagiarismCheck } = require('../modules/plagiarismChecker');

// Example usage
async function checkThesis(fullText, localTheses) {
    try {
        const report = await performPlagiarismCheck(fullText, localTheses);
        
        console.log(`Overall Plagiarism Score: ${report.overallScore}%`);
        console.log(`Risk Verdict: ${report.verdict}`);
        
        // Local Match Results
        console.log(`Top Local Match:`, report.localSimilarity.topMatches[0]);
        
        // Web Match Results
        console.log(`Web Matches found:`, report.webSimilarity.matches.length);
        console.log(`Sources found:`, report.webSimilarity.sourcesFound);
        
        return report;
    } catch (err) {
        console.error("Plagiarism analysis failed:", err);
    }
}
```

### Module Exports

The module exports several granular functions, enabling you to run checks independently:

```javascript
module.exports = {
    performPlagiarismCheck,         // Combined hybrid check
    checkLocalSimilarity,           // Local check only (lexical + semantic)
    checkWebPlagiarism,             // Web check only (DuckDuckGo search)
    createShingles,                 // Word-level k-shingle generator
    jaccardSimilarity,              // Jaccard similarity calculator
    containmentSimilarity,           // Containment similarity calculator
    TfidfVectorizer,                // Pure JS TF-IDF Vectorizer
    cosineSimilarity,               // Vector cosine similarity helper
    getSentenceEmbedding            // Transformer embedding vector generator
};
```

---

## Model Caching & Performance Details

* **Model File size:** The `Xenova/all-MiniLM-L6-v2` model is stored in ONNX format and takes up **~90MB**.
* **Automatic Cache:** On the first scan, the model files are downloaded from Hugging Face automatically. Subsequent scans fetch the model directly from the local filesystem cache (`~/.cache/huggingface/` or project node directory), running instantly.
* **CPU Execution:** Inference runs entirely on the local CPU, eliminating GPU setup complexities or memory requirements.
