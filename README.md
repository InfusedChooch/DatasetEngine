# 🛠️ Dataset Engine - The Ultimate CV Data Studio

<a name="readme-top"></a>

<div align="center">
  
  ![Dataset Engine Banner](frontend/public/banner.jpg)
  
  [![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
  [![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
  [![React 18](https://img.shields.io/badge/react-18.0+-61dafb.svg)](https://reactjs.org/)
  [![FastAPI](https://img.shields.io/badge/FastAPI-0.104+-009688.svg)](https://fastapi.tiangolo.com/)
  [![Powered By YOLO](https://img.shields.io/badge/AI-Ultralytics%20YOLO-purple)](https://github.com/ultralytics/ultralytics)
  
  **An all-in-one local GUI to visualize, analyze, merge, and rapidly improve your Computer Vision datasets.**
  
  [🌟 Overview](#-overview) • 
  [✨ Key Features](#-key-features) •
  [📸 UI Showcase](#-ui-showcase) •
  [🔄 Pipeline & Modules](#-how-it-works) •  
  [🛠 Tech Stack](#-tech-stack) •
  [🚀 Getting Started](#-getting-started) • 
  [📜 License](#-license) •
  [👨‍💻 Author](#author)
  <br><br>

  **If you find Dataset Engine useful, please consider supporting the development!** <br>
  <a href="https://www.buymeacoffee.com/sPappalard">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="180" />
  </a>
  
</div>

---

## 🌟 Overview

**Dataset Engine** is an advanced, 100% locally-hosted studio designed to solve the most painful parts of building Object Detection models. 
Whether you have a messy dataset full of duplicates, need to merge datasets with conflicting class names, or want to rapidly test your YOLO model on a video to find and fix its blind spots—Dataset Engine handles it all through a blazing-fast React interface.

### What Makes Dataset Engine Special?

- **Zero Cloud Costs:** Everything runs locally on your machine. No data leaves your computer, ensuring absolute privacy for sensitive industrial or medical datasets.
- **Smart Data Cleaning:** Automatically detects completely identical images and overlapping/duplicate bounding boxes, fixing them with a single click.
- **Active Learning Loop (Improver):** Test your `.pt` YOLO weights directly on raw videos. The system auto-extracts frames, runs inference, lets you flag failures, and provides a Photoshop-style canvas to correct the annotations for your next training run.
- **Format Agnostic:** Natively supports standard YOLO formats, perfectly handling structures like `images/train` and `labels/train`, or the typical Roboflow `../valid/images` exports without breaking.

---

## 🎬 Demo

<div align="center">
  
  **Watch Dataset Engine in Action**
  
  [![Dataset Engine Demo](https://img.youtube.com/vi/YOUR_VIDEO_ID/maxresdefault.jpg)](https://www.youtube.com/watch?v=YOUR_VIDEO_ID)
  
  *Click to watch the full demonstration on YouTube*
  
</div>

---

## ✨ Key Features

### 🔍 1. Dataset Viewer
- **Deep Filtering:** Filter thousands of images instantly by split (`train`, `val`, `test`), required classes, object count, or even specific bounding box sizes (e.g., "Find images with tiny objects under 1% area").
- **Apple-Style UX:** Fluid Masonry/Grid layouts with hover-to-zoom pop-outs and detailed inspector modals.

### 📊 2. Analyzer & Data Health
- **Distribution Charts:** Interactive Recharts graphs showing class imbalances and object size distributions.
- **Duplicate Image Detection:** Finds exact copy images in your dataset and safely removes them while keeping the best annotation.
- **Duplicate Label Fixer:** Detects overlapping identical bounding boxes (common in bad auto-labeling) and purges them.

### 🔀 3. Merger Matrix
- **Visual Re-mapping:** Combine multiple datasets. If Dataset A calls it "Car" and Dataset B calls it "Vehicle", map them both to a single output class easily.
- **Auto Re-Split:** Define your ideal ratio (e.g., 70% Train, 20% Val, 10% Test) and the engine will shuffle and correctly regenerate the dataset structure.

### 🎯 4. The Improver (Active Learning)
- **Video-to-Dataset:** Upload a video and a YOLO model. The engine samples frames and auto-annotates them.
- **Triage Mode:** Quickly swipe through predictions and flag frames where the model failed (False Positives/Negatives).
- **Annotation Editor:** A built-in Konva.js canvas to manually fix bounding boxes, adjust classes, and export the corrected frames as a pristine dataset ready for fine-tuning.

---

## 📸 UI Showcase

### The Viewer Module
*Explore and filter your datasets visually without touching a single line of Python.*
<div align="center">
  <img src="public/viewer-screenshot.jpg" alt="Dataset Viewer" width="100%">
</div>

### Deep Analysis & Cleaning
*Spot imbalances instantly and fix duplicate labels or images with built-in destructive (but safe) tools.*
<div align="center">
  <img src="public/analyzer-screenshot.jpg" alt="Dataset Analyzer" width="100%">
</div>

### Intelligent Dataset Merging
*A visual mapping matrix to route classes from multiple sources into a unified, clean dataset.*
<div align="center">
  <img src="public/merger-screenshot.jpg" alt="Dataset Merger" width="100%">
</div>

### Built-in Annotation Canvas
*Fix your model's mistakes manually using intuitive drawing and selection tools, just like a pro editor.*
<div align="center">
  <img src="public/editor-screenshot.jpg" alt="Annotation Editor" width="100%">
</div>

---

## 🔄 How It Works (The Improver Loop)

<div align="center">
  
  ![Improver Pipeline](public/pipeline.png)
  
</div>

1. **Test:** Feed a raw video and your current `best.pt` YOLO model to the Engine.
2. **Review:** Use the *Fast Review* grid to quickly spot where the model messed up.
3. **Correct:** Enter the *Annotation Editor* to delete wrong boxes and draw the correct ones.
4. **Export & Retrain:** Export the newly corrected frames and merge them with your original dataset to train a smarter model.

---

## 🛠 Tech Stack

### Backend Stack
- **FastAPI**: Asynchronous Python web framework for lightning-fast local API endpoints.
- **Ultralytics**: Core inference engine natively supporting YOLOv8, YOLOv9, YOLOv10, and YOLOv11 (`.pt` weights).
- **OpenCV & PyYAML**: For heavy image parsing and `.yaml` dataset management.

### Frontend Stack
- **React 18 + Vite**: For a snappy, instant-reload user interface.
- **Tailwind CSS**: Modern, utility-first styling with a dark "glassmorphism" aesthetic.
- **React-Konva**: Hardware-accelerated HTML5 Canvas for the bounding-box editor.
- **Recharts**: For dynamic, interactive data visualization.

---

## 📂 Repository Structure

```text
dataset-engine/
│
├── backend/                           # FastAPI Backend
│   ├── BEvenv/                        # Virtual Environment (Generated)
│   ├── models/                        # YOLO Model storage
│   ├── routers/                       # API Endpoints (viewer, analyze, etc.)
│   ├── services/                      # Core business logic & file processing
│   ├── main.py                        # FastAPI Entry Point
│   └── requirements.txt               # Python Dependencies
│
├── frontend/                          # React + Vite Frontend
│   ├── public/                        # Static Assets
│   ├── src/
│   │   ├── hooks/                     # Zustand state management
│   │   ├── pages/                     # UI Views (Viewer, Merger, Analyzer, etc.)
│   │   └── App.jsx                    # Routing & Main Layout
│   ├── package.json                   # Node Dependencies
│   ├── tailwind.config.js             # Styling configuration
│   └── vite.config.js                 # Bundler configuration
│
└── README.md                          # You are here!

```

---

## 🚀 Getting Started

Follow these steps to set up Dataset Engine on your local machine.

### Prerequisites

* **Python 3.10+**
* **Node.js 18+** ### 1. Backend Setup

Open a terminal and navigate to the backend folder:

```bash
# Navigate to backend
cd backend

# Create a virtual environment (Recommended)
python -m venv BEvenv

# Activate the virtual environment
# On Windows:
BEvenv\Scripts\activate
# On macOS/Linux:
source BEvenv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Start the FastAPI server
uvicorn main:app --reload

```

*The backend should now be running on `http://localhost:8000`.*

### 2. Frontend Setup

Open a **new** terminal window and navigate to the frontend folder:

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev

```

### 3. Launch

Open your browser and navigate to **`http://localhost:5173`**.
You are ready to manage your datasets!

---

<a name="author"></a>

## 👨‍💻 Author

**Dataset Engine** is created and maintained by **sPappalard**.

If you find this project useful, please give it a ⭐ star or support the development!

<div align="center">

</div>

---

## 📄 License

This project is released under the **MIT** license.

Copyright (c) 2025 sPappalard.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```

---

<div align="center">

**Built with ❤️ by [@sPappalard**](https://github.com/sPappalard)

[⬆ Back to Top](https://www.google.com/search?q=%23readme-top)

</div>

