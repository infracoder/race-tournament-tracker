FROM node:23-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Create data directory for database
RUN mkdir -p /data

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_FILE=/data/tournament.db

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
