FROM node:20

# Install Calibre and its system dependencies
# libegl1 and libopengl0 are required by the Calibre installer.
# We also clean up the apt cache in the same layer to reduce image size.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    xz-utils \
    libegl1 \
    libopengl0 \
    libxcb-cursor0 \
    libfuse2 \
    libnss3 \
    libxkbcommon-x11-0 \
    libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

# Run the Calibre installer non-interactively
RUN wget -nv -O- https://download.calibre-ebook.com/linux-installer.sh | sh -s -- install_dir=/opt
# Add Calibre to the system's PATH so `ebook-convert` can be found
# Also, add Calibre's libraries to the dynamic linker's search path.
ENV PATH="/opt/calibre/bin:${PATH}"
ENV LD_LIBRARY_PATH="/opt/calibre/lib:${LD_LIBRARY_PATH}"

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

CMD [ "node", "bot.js" ]
