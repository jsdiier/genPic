from flask import Flask, request, jsonify
import json
import os

app = Flask(__name__)

SAVE_PATH = "/Users/didi/Documents/trae_projects/img2img/generated_results.jsonl"


@app.route("/callback", methods=["POST"])
def callback():

    data = request.json

    print("\n🔥 NanoBanana Callback Received:")
    print(json.dumps(data, indent=2, ensure_ascii=False))

    # =====================
    # 正确解析
    # =====================
    if data.get("code") == 200:

        task_id = data["data"]["taskId"]
        image_url = data["data"]["info"]["resultImageUrl"]

        print("✅ 生成成功:", image_url)

        with open(SAVE_PATH, "a") as f:
            f.write(json.dumps({
                "task_id": task_id,
                "image": image_url
            }) + "\n")

    else:
        print("❌ 任务失败:", data)

    return jsonify({"msg": "ok"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8081)