docker rmi $(docker images -aq "mahook-*")
docker build -t mahook-web -f dockerfile .
docker build -t mahook-db -f dockerfile.mariadb .
echo "docker build complete!"