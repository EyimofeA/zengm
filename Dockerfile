# Use an official Node.js runtime as a parent image
FROM node:20

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package.json package-lock.json* ./

# Install dependencies using npm
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the application (if necessary)
RUN npm run build

# Expose the port the app runs on
EXPOSE 3006

# Define the command to run the application
CMD ["npm", "run", "start","--", "--host"]