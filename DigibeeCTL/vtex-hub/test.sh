#! /bin/bash

source .env

function get_projects() {
  local API_KEY="$1"
  local TOKEN="$2"
  local REALM="$3"
  local OUTPUT_FILE="$4"


  # Query Digibee's graphql to get projects, format JSON and save to file
  allProjects=$(curl  -s 'https://core.godigibee.io/graphql' \
    -H 'apikey: '${API_KEY} \
    -H 'authorization: Bearer '${TOKEN} \
    -H 'content-type: application/json' \
    --data-raw $'{"operationName":"project","variables":{"realm":"'${REALM}'"},"query":"query project($realm: String\u0021) { project(realm: $realm) { id name description amountOfPipelines allowAllUsers allowedGroups allowedUsers } } "}' \
    --compressed | jq '.')
  
  i=0
  while read projectId; do
      pipelinesInProject=$(curl -s 'https://core.godigibee.io/graphql' \
        -H 'apikey: '${API_KEY} \
        -H 'authorization: Bearer '${TOKEN} \
        -H 'content-type: application/json' \
        --data-raw $'{"operationName":"searchPipelines","variables":{"realm":"'${REALM}'","search":{"name":"","projectId":'${projectId}'}},"query":"query searchPipelines($realm: String\u0021, $search: JSON) { searchPipelines(realm: $realm, search: $search) { content last number first numberOfElements size } } "}' \
        --compressed | jq '.data.searchPipelines.content[]._id')
  
      pipelinesInProject=$(printf ",%s" ${pipelinesInProject[@]})
      pipelinesInProject="${pipelinesInProject:1}"
  
      allProjects=$(jq '.data.project['${i}'].pipes += ['${pipelinesInProject}']' <<<"$allProjects")
      ((i++))
  done < <(jq '.data.project[].id' <<< "$allProjects")
}

get_projects "${GRAPHQL_API_KEY}" "${GRAPHQL_TOKEN}" "vtex-hub" "test.json"