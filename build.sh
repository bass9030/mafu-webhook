docker-compose -f docker-compose-dev.yaml down
docker rmi $(docker images -aq "mahook-*-dev")
docker build -t mahook-web-dev -f dockerfile .
docker build -t mahook-db-dev -f dockerfile.mariadb .

docker-compose -f docker-compose-dev.yaml up -d
echo "docker build complete!"
read -p "Press enter to exit..."