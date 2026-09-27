# Bee Colony: An ABM Classic Use Case
# Self-contained image: deps + model + prebuilt React/Vite web UI.
# (The UI is built during development — see frontend/ and the README —
#  so the image needs no Node.js.)
FROM python:3.11-slim

WORKDIR /app

# Python deps first (better layer caching).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code: model package, FastAPI app, and the built SPA.
COPY bee_colony ./bee_colony
COPY app ./app
COPY frontend/dist ./frontend/dist

EXPOSE 8550

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8550"]