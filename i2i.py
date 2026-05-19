import requests
import sys

API_KEY = "d21a6f21367e966a41c225bac07eb9f4"
API_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate"
CALLBACK_URL = "https://natechen.pagekite.me/callback"


def submit_task(prompt, image_urls=None):
    """
    文生图: image_urls 不传或传 None
    图生图: image_urls 传入图片URL列表，如 ["https://example.com/cat.jpg"]
    """
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }

    if image_urls:
        task_type = "IMAGETOIAMGE"
    else:
        task_type = "TEXTTOIAMGE"

    payload = {
        "prompt": prompt,
        "type": task_type,
        "numImages": 1,
        "image_size": "1:1",
        "callBackUrl": CALLBACK_URL
    }

    if image_urls:
        payload["imageUrls"] = image_urls

    response = requests.post(API_URL, headers=headers, json=payload)
    result = response.json()

    if result["code"] != 200:
        raise Exception(result)

    task_id = result["data"]["taskId"]
    print(f"✅ [{task_type}] 任务提交成功: {task_id}")
    return task_id


if __name__ == "__main__":

    # ========== 示例1: 文生图 ==========
    submit_task(
        prompt="一只可爱的小猫坐在窗边看雨"
    )

    # ========== 示例2: 图生图 ==========
    # submit_task(
    #     prompt="把小猫变成卡通风格",
    #     image_urls=["https://example.com/cat.jpg"]
    # )