import requests
import openai
import base64
import io
import sys

NANO_API_KEY = "d21a6f21367e966a41c225bac07eb9f4"
NANO_API_URL = "https://api.nanobananaapi.ai/api/v1/nanobanana/generate-2"
CALLBACK_URL = "https://natechen.pagekite.me/callback"

OPENAI_API_KEY = "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"

# =====================
# Nano Banana 2
# =====================
def nano_submit_task(prompt, image_urls=None, aspect_ratio="auto", resolution="1K"):
    """
    文生图: image_urls 不传或传 None
    图生图: image_urls 传入图片URL列表
    """
    headers = {
        "Authorization": f"Bearer {NANO_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "prompt": prompt,
        "imageUrls": image_urls or [],
        "aspectRatio": aspect_ratio,
        "resolution": resolution,
        "outputFormat": "jpg",
        "callBackUrl": CALLBACK_URL
    }

    response = requests.post(NANO_API_URL, headers=headers, json=payload)
    result = response.json()

    if result["code"] != 200:
        raise Exception(result)

    task_id = result["data"]["taskId"]
    mode = "图生图" if image_urls else "文生图"
    print(f"✅ [Nano2 {mode}] 任务提交成功: {task_id}")
    return task_id


# =====================
# GPT Image 2
# =====================
def gpt_generate(prompt, size="1024x1024", quality="medium"):
    """
    GPT Image 2 文生图，同步返回，直接保存到 output_gpt.jpg
    """
    client = openai.OpenAI(api_key=OPENAI_API_KEY)
    result = client.images.generate(
        model="gpt-image-2",
        prompt=prompt,
        size=size,
        quality=quality,
        response_format="b64_json"
    )
    image_bytes = base64.b64decode(result.data[0].b64_json)
    with open("output_gpt_t2i.jpg", "wb") as f:
        f.write(image_bytes)
    print("✅ [GPT Image 2 文生图] 生成成功，已保存到 output_gpt_t2i.jpg")


def gpt_img2img(prompt, image_urls, size="1024x1024", quality="medium"):
    """
    GPT Image 2 图生图，传入图片URL列表，同步返回，保存到 output_gpt_i2i.jpg
    """
    client = openai.OpenAI(api_key=OPENAI_API_KEY)

    image_files = []
    for url in image_urls:
        resp = requests.get(url)
        buf = io.BytesIO(resp.content)
        buf.name = "image.jpg"
        image_files.append(buf)

    result = client.images.edit(
        model="gpt-image-2",
        image=image_files,
        prompt=prompt,
        size=size,
        quality=quality
    )
    image_bytes = base64.b64decode(result.data[0].b64_json)
    with open("output_gpt_i2i.jpg", "wb") as f:
        f.write(image_bytes)
    print("✅ [GPT Image 2 图生图] 生成成功，已保存到 output_gpt_i2i.jpg")


if __name__ == "__main__":

    # ========== Nano2 文生图 ==========
    # nano_submit_task(prompt="一只可爱的小猫坐在窗边看雨")

    # ========== Nano2 图生图 ==========
    # nano_submit_task(
    #     prompt="把小猫变成卡通风格",
    #     image_urls=["https://example.com/cat.jpg"]
    # )

    # ========== GPT Image 2 文生图 ==========
    # gpt_generate(prompt="一只可爱的小猫坐在窗边看雨")

    # ========== GPT Image 2 图生图 ==========
    gpt_img2img(
        prompt="将图片色系改成绿色",
        image_urls=["https://genpic-images.oss-cn-shanghai.aliyuncs.com/uploads/cbefd34c-3df0-407e-80fd-31e0f71bd87e.png"]
    )