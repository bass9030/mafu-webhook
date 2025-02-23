docker-compose -f docker-compose-dev.yaml down
docker rmi -f $(docker images -aq "mahook*")
docker build -t mahook-web -f dockerfile .
docker build -t mahook-db -f dockerfile.mariadb .

docker-compose -f docker-compose-dev.yaml up -d
echo "docker build complete!"
read -p "Press enter to exit..."