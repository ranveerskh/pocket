export default {
  "461": {
    "class_type": "SaveImageAdvanced",
    "inputs": {
      "filename_prefix": "image/PocketStudio_Qwen21",
      "format": "png",
      "format.bit_depth": "8-bit",
      "format.input_color_space": "sRGB",
      "images": [
        "459:457",
        0
      ]
    }
  },
  "459:451": {
    "class_type": "UNETLoader",
    "inputs": {
      "unet_name": "qwen_image_2.1_int8_convrot.safetensors",
      "weight_dtype": "default"
    }
  },
  "459:452": {
    "class_type": "TextEncodeQwenImage21",
    "inputs": {
      "prompt": "A ceramic mug on a wooden table in soft window light.",
      "negative_prompt": "",
      "resolution": 1024,
      "clip": [
        "459:453",
        0
      ]
    }
  },
  "459:453": {
    "class_type": "CLIPLoader",
    "inputs": {
      "clip_name": "qwen3vl_8b_int8_convrot.safetensors",
      "type": "qwen_image",
      "device": "default"
    }
  },
  "459:454": {
    "class_type": "VAELoader",
    "inputs": {
      "vae_name": "qwen_image_2.1_vae_bf16.safetensors"
    }
  },
  "459:456": {
    "class_type": "EmptyLatentImage",
    "inputs": {
      "width": 1024,
      "height": 1024,
      "batch_size": 1
    }
  },
  "459:457": {
    "class_type": "VAEDecode",
    "inputs": {
      "samples": [
        "459:458",
        0
      ],
      "vae": [
        "459:454",
        0
      ]
    }
  },
  "459:458": {
    "class_type": "KSampler",
    "inputs": {
      "seed": 447606998181262,
      "steps": 25,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": 1,
      "model": [
        "459:480",
        0
      ],
      "positive": [
        "459:452",
        0
      ],
      "negative": [
        "459:452",
        1
      ],
      "latent_image": [
        "459:456",
        0
      ]
    }
  },
  "459:480": {
    "class_type": "QwenImage21Cache",
    "inputs": {
      "device": "auto",
      "dtype": "default",
      "model": [
        "459:451",
        0
      ]
    }
  }
};
