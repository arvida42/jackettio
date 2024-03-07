#!/bin/bash

set -e

# Check if docker is installed
if ! command -v docker >/dev/null 2>&1; then
    echo "Error: Docker is not installed on this machine."
    echo "https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
    apt-get update && apt-get install curl -y
fi

COMMAND="$1"
RAW_GITHUB_URL="https://raw.githubusercontent.com/arvida42/jackettio/master"
DIR=$(dirname "$0")
ENV_FILE="$DIR/.env.production"
JACKETT_PASSWORD=""

ACME_DOMAIN=""
ACME_EMAIL=""
INSTALL_TYPE=""
LOCALTUNNEL=""
JACKETT_URL="http://jackett:9117"
JACKETT_API_KEY=""
PORT=4000
COMPOSE_FILE=""

cd $DIR

importConfig() {
    if [ ! -f "$ENV_FILE" ]; then
        echo "Configuration file not found: $ENV_FILE"
        echo "Are you in the corect folder to run this command ?"
        exit 1
    fi
    source $ENV_FILE
}

runDockerCompose() {
    docker compose -f docker-compose.yml -f $COMPOSE_FILE --env-file $ENV_FILE "$@"
}

downloadComposeFiles() {
    echo "Downloading compose files ..."
    curl -fsSL "${RAW_GITHUB_URL}/docker-compose.yml" -o docker-compose.yml
    curl -fsSL "${RAW_GITHUB_URL}/${COMPOSE_FILE}" -o $COMPOSE_FILE
}

sedReplace(){
    if [[ "$OSTYPE" == darwin* ]]; then
        sed -i '' "$@"
    else
        sed -i "$@"
    fi
}

createJackettPassword(){

    FILE=$1
    JACKETT_API_KEY=$(sed -n 's/.*"APIKey": "\(.*\)",/\1/p' $FILE)

    if command -v openssl &> /dev/null; then
        echo " - Generate password using openssl"
        JACKETT_PASSWORD=$(openssl rand -base64 12)
    else
        echo " - Generate password using /dev/urandom "
        JACKETT_PASSWORD=$(tr -dc A-Za-z0-9_ < /dev/urandom | head -c 12)
    fi

    echo " - Create password hash ..."
    # https://github.com/Jackett/Jackett/blob/d560175c20a64c0d5379ceb7178810d00b71498d/src/Jackett.Server/Services/SecurityService.cs#L26
    NODE_COMMAND="node -e \"const crypto = require('crypto');
    const input = '${JACKETT_PASSWORD}${JACKETT_API_KEY}';
    const hash = crypto.createHash('sha512');
    hash.update(Buffer.from(input, 'utf16le'));
    console.log(hash.digest().toString('hex'));\""
    JACKETT_PASSWORD_HASH=$(docker run --rm node:20-slim sh -c "$NODE_COMMAND")

    sedReplace 's/"AdminPassword": .*,/"AdminPassword": "'"$JACKETT_PASSWORD_HASH"'",/' $FILE

}

showHelp(){
    cat <<-END

Usage: sh ./cli.sh [command]

Available commands:

    start               Start all containers
    stop                Stop all containers
    down                Stop and remove all containers
    update              Update all containers
    install             Install and configure all containers
    jackett-password    Reset jackett password

END
}

# Store information in an environment file
saveConfig() {
cat <<EOF > $ENV_FILE
ACME_DOMAIN=$ACME_DOMAIN
ACME_EMAIL=$ACME_EMAIL
INSTALL_TYPE=$INSTALL_TYPE
LOCALTUNNEL=$LOCALTUNNEL
JACKETT_URL=$JACKETT_URL
JACKETT_API_KEY=$JACKETT_API_KEY
PORT=$PORT
COMPOSE_FILE=$COMPOSE_FILE
EOF
}

case "$COMMAND" in
    "--help"|"help")
        showHelp
        exit 0
        ;;
    "start")
        importConfig
        runDockerCompose up -d
        exit 0
        ;;
    "stop" | "down")
        importConfig
        runDockerCompose $COMMAND
        exit 0
        ;;
    "update")
        importConfig
        runDockerCompose down
        downloadComposeFiles
        runDockerCompose pull
        runDockerCompose up -d
        exit 0
        ;;
    "jackett-password")
        importConfig
        docker cp jackett:/config/Jackett/ServerConfig.json /tmp/ServerConfig.json > /dev/null
        createJackettPassword /tmp/ServerConfig.json
        docker cp /tmp/ServerConfig.json jackett:/config/Jackett/ServerConfig.json > /dev/null
        rm -f /tmp/ServerConfig.json
        echo "Restart jackett ..."
        docker restart jackett
        echo "Your new password is: $JACKETT_PASSWORD"
        echo "Please change it for security in jackett dashboard"
        exit 0
        ;;
    "install")
        echo "Install ..."
        ;;
    *)
         echo -e "\033[0;31mInvalid command: ${COMMAND}\033[0m"
        showHelp
        exit 1
        ;;
esac

if [ -f "$ENV_FILE" ]; then
    echo -e "\033[0;31mAn installation appears to already exist and will be overwritten ! ($ENV_FILE)\033[0m"
    read -p "  Continue and overwrite ? (y/n): " continue
    if [[ $continue != "yes" && $continue != "y" ]]; then
        echo "Exiting..."
        exit
    fi
fi

cat <<-END

This script will install compose and environments file in the following folder
-----------------------
${PWD}
-----------------------
END
read -p "Are you sure you want to continue? (y/n): " continue
if [[ $continue != "yes" && $continue != "y" ]]; then
    echo "Exiting..."
    exit
fi

cat <<-END

Please select an installation type:

    1) Using traefik
       You must have a domain configured for this machine, ports 80 and 443 must be opened.
       Your Addon will be available on the address: https://your_domain

    2) Using localtunnel
       This installation use "localtunnel" to expose the app on Internet.
       There's no need to configure a domain; you can run it directly on your local machine.
       However, you may encounter limitations imposed by LocalTunnel.
       All requests from the addons will go through LocalTunnel.
       Your Addon will be available on the address: https://random-id.localtunnel.me

    3) Local
       Install locally without domain. Stremio App must run in same machine to works.
       Your Addon will be available on the address: http://localhost

END

read -p "Please chose 1,2 or 3): " INSTALL_TYPE

case "$INSTALL_TYPE" in
    "1")
        echo "traefik selected"
        read -p "Please enter your domain name (example.com): " ACME_DOMAIN
        read -p "Please enter your email (email@example.com): " ACME_EMAIL
        COMPOSE_FILE=docker-compose-traefik.yml
        echo "Your domain: ${ACME_DOMAIN}"
        echo "Your email: ${ACME_EMAIL}"
        ;;
    "2")
        echo "localtunnel selected"
        COMPOSE_FILE=docker-compose-tunnel.yml
        LOCALTUNNEL="true"
        ;;
    "3")
        echo "local selected"
        COMPOSE_FILE=docker-compose-local.yml
        ;;
    *)
        echo "Invalid installation type: ${INSTALL_TYPE}"
        echo "Must be 1,2 or 3"
        exit 1
        ;;
esac

saveConfig
echo "------------------"
cat $ENV_FILE
echo ""
echo "Please confirm the above information before proceeding."
read -p "Continue ? (y/n): " continue
if [[ $continue != "yes" && $continue != "y" ]]; then
    echo "Exiting..."
    exit
fi

downloadComposeFiles

echo "Configure jackett ..."
runDockerCompose up -d jackett
echo "Wait for jackett ..."
sleep 6
docker cp jackett:/config/Jackett/ServerConfig.json /tmp/ServerConfig.json > /dev/null
JACKETT_API_KEY=$(sed -n 's/.*"APIKey": "\(.*\)",/\1/p' /tmp/ServerConfig.json)
JACKETT_PASSWORD_HASH=$(sed -n 's/.*"AdminPassword": "\(.*\)",/\1/p' /tmp/ServerConfig.json)

if [ -z "$JACKETT_PASSWORD_HASH" ]; then
    echo " - Configure jackett admin password ..."
    createJackettPassword /tmp/ServerConfig.json
fi

echo " - Configure jackett flaresolverr url ..."
sedReplace 's/"FlareSolverrUrl": .*,/"FlareSolverrUrl": "http:\/\/flaresolverr:8191",/' /tmp/ServerConfig.json
docker cp /tmp/ServerConfig.json jackett:/config/Jackett/ServerConfig.json > /dev/null
rm -f /tmp/ServerConfig.json
runDockerCompose down

saveConfig

echo "Start all containers ..."
runDockerCompose up -d


echo "-----------------------"


echo -e "\n\033[0;32mInstallation complete! \033[0m\n"
case "$INSTALL_TYPE" in
    "1")
        echo " - Your addon is available on the following address: https://${ACME_DOMAIN}/configure"
        ;;
    "2")
        echo "Wait for Jackettio ..."
        sleep 4
        runDockerCompose logs -n 30 jackettio
        ;;
    "3")
        echo " - Your addon is available on the following address: http://localhost:4000/configure"
        ;;
esac

echo " - Your Jackett instance to configure your trackers is available on the following address: http://localhost:9117 or http://${ACME_DOMAIN:-your_public_ip}:9117"
echo "   Be aware that having a lot of trackers may slow down search queries within the addon. We recommend utilizing trackers that do not have Cloudflare protection."

if [ ! -z "$JACKETT_PASSWORD" ]; then
    echo -e "\n - \033[0;31mIMPORTANT:\033[0m The default password for Jackett is \"${JACKETT_PASSWORD}\", Please change it for security in jackett dashboard."
fi

echo "-----------------------"
