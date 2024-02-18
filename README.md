# jackettio

Selfhosted Stremio addon that resolve streams using Jackett and Debrid. It seamlessly integrates with private trackers.

## Features

- Resolve streams using Jackett and Debrid
- Public / Private trackers
- TV packs priority
- Sorting
- Qualities filter
- Excludes keywords

## Automatic installation using cli script (recommended)

The cli script will install, configure, secure and update your addon. **Docker must be installed on your machine for the automatic installation.**

Three automatic installation options are available using cli script:

- 1) **Traefik** - 
 You must have a domain configured for this machine, ports 80 and 443 must be opened.
 Your Addon will be available on the address: `https://your_domain`
 You can use [noip](https://www.noip.com) to create a free domain.

- 2) **Localtunnel** - 
 This installation use "[localtunnel](https://localtunnel.me/)" to expose the app on Internet.
 There's no need to configure a domain; you can run it directly on your local machine.
 However, you may encounter limitations imposed by LocalTunnel.
 All requests from the addons will go through LocalTunnel.
 Your Addon will be available on the address like `https://random-id.localtunnel.me`

- 3) **Local** - 
 Install locally without domain. Stremio App must run in same machine to work.
 Your Addon will be available on the address: `http://localhost`

### Installation on Mac or Linux

```sh
# Create the directory where you want to store the installation configs
mkdir /home/jackettio && cd /home/jackettio

# Download the cli script
curl -fsSL https://raw.githubusercontent.com/arvida42/jackettio/master/cli.sh -o cli.sh

# Run the install
chmod +x ./cli.sh && ./cli.sh install
```


### cli scripts commands details
```sh
# Install and configure the addons
./cli.sh install

# Update all containers to the last version
./cli.sh update

# Stop all containers
./cli.sh stop

# Start all containers
./cli.sh start

# Stop and remove all containers.
./cli.sh down
```

## Manual installation

**You must have a Jackett instance installed for manual installation.**

```sh
# Clone the repo
git clone https://github.com/arvida42/jackettio.git

# Go inside the folder
cd jackettio

# Install dependencies
npm install

# Run
JACKETT_API_KEY=API_KEY JACKETT_URL=http://localhost:9117 npm start
```

All environment variables and default values are defined in the [config.js file](https://github.com/arvida42/jackettio/blob/master/src/lib/config.js).