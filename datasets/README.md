# Dataset Drop Zone

Place local YOLO detection datasets under this folder.

Expected pattern:

```text
datasets/<dataset_name>/
  images/train
  images/val
  labels/train
  labels/val
  data.yaml
```

This folder is runtime storage and is git-ignored by default, except:
- `datasets/.gitkeep`
- `datasets/README.md`
