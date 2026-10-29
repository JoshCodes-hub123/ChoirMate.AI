# ChoirMate AI — Production Multi-Runtime Container (Node.js 20 LTS + Python 3.11)
FROM python:3.11-slim-bookworm

# Set non-interactive debian frontend
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    PORT=3000

# Install system dependencies: Node.js 20 LTS, FFmpeg, OpenCV/PDF graphics libraries, and build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    build-essential \
    cmake \
    g++ \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1. Install Python dependencies with pre-compiled CPU llama-cpp-python wheels
COPY python/requirements.txt ./python/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu -r python/requirements.txt

# 2. Pre-cache HOMR ONNX weights during image build so startup is instant
RUN python3 -c "from homr.main import download_weights; download_weights(False)"

# 3. Install Node.js dependencies
COPY package*.json ./
RUN npm install

# 4. Copy source code and assets
COPY . .

# 5. Build static Vite frontend
RUN npm run build

# 6. Ensure entrypoint is executable
RUN chmod +x docker-entrypoint.sh

# Render dynamically sets PORT (defaults to 3000)
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
