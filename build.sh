docker-compose -f docker-compose-dev.yaml down
docker rmi $(docker images -aq "mahook-*-dev")
docker build -t mahook-web-dev -f dockerfile .
docker build -t mahook-db-dev -f dockerfile.mariadb .
echo "docker build complete!"
docker-compose -f docker-compose-dev.yaml up