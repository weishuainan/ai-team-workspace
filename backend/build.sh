#!/bin/bash
set -e

# 在当前构建目录直接创建 venv，install.sh 的 venv/bin/uvicorn 就可以直接找到
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
