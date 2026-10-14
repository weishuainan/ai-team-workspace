#!/bin/bash
set -e

curl --fail --silent --show-error "http://$1/"
