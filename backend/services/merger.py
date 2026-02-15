import yaml
import shutil
import random
import json
from pathlib import Path
from models.schemas import MergeRequest, DatasetInfo
import os

class MergerService:
    
    @staticmethod
    def get_dataset_info(yaml_path_str: str) -> DatasetInfo:
        """
        Reads the dataset info (classes, number of images) to display in the frontend.
        """
        yaml_path = Path(yaml_path_str)
        if not yaml_path.exists():
            raise FileNotFoundError(f"YAML not found: {yaml_path}")
            
        with open(yaml_path, 'r') as f: config = yaml.safe_load(f)
        
        base_dir = yaml_path.parent
        classes = config.get('names', {})
        
        # Normalize classes in a dictionary {id: name}
        if isinstance(classes, list): classes = {i: n for i, n in enumerate(classes)}
        elif isinstance(classes, dict): classes = {int(k): v for k, v in classes.items()}
        
        split_stats = {'train': 0, 'val': 0, 'test': 0}
        
        # Search for images in standard folders (train, val, test)
        for split in ['train', 'val', 'test']:
            candidates = [
                base_dir / split / 'images',
                base_dir / 'images' / split,
                base_dir / split,
            ]
            
            # If the yaml specifies a path, use it as a priority
            if config.get(split):
                p_yaml = Path(config[split])
                if not p_yaml.is_absolute(): p_yaml = (base_dir / p_yaml).resolve()
                candidates.insert(0, p_yaml)

            for p in candidates:
                if p.exists() and p.is_dir():
                    # Count image file
                    count = sum(1 for _ in p.rglob('*') if _.suffix.lower() in {'.jpg','.png','.jpeg','.webp','.bmp'})
                    if count > 0:
                        split_stats[split] = count
                        break

        total = sum(split_stats.values())
        
        return DatasetInfo(
            path=str(yaml_path),
            name=yaml_path.parent.name,
            classes=classes,
            total_images=total,
            split_stats=split_stats
        )

    @staticmethod
    def merge_datasets_generator(req: MergeRequest):
        """
        GENERATOR: Merges and sends updates in real time (Streaming).
        """
        output_dir = Path(req.output_path)
        
        # 1. Creating Folders
        yield json.dumps({"type": "log", "msg": "📁 Creating directory structure..."}) + "\n"
        
        if not output_dir.exists():
            output_dir.mkdir(parents=True, exist_ok=True)
            
        dirs = {
            'train': (output_dir / 'images' / 'train', output_dir / 'labels' / 'train'),
            'val': (output_dir / 'images' / 'val', output_dir / 'labels' / 'val'),
            'test': (output_dir / 'images' / 'test', output_dir / 'labels' / 'test')
        }
        for img_d, lbl_d in dirs.values():
            img_d.mkdir(parents=True, exist_ok=True)
            lbl_d.mkdir(parents=True, exist_ok=True)

        # 2. Preparation Mapping Classes
        # map_lookup[dataset_index][old_class_id] = new_class_id
        map_lookup = {}
        for rule in req.mappings:
            if rule.dataset_index not in map_lookup: map_lookup[rule.dataset_index] = {}
            map_lookup[rule.dataset_index][rule.source_class_id] = rule.target_class_id

        # 3. Image Collection ("The Cauldron")
        all_items = []
        yield json.dumps({"type": "log", "msg": f"🔍 Scanning {len(req.datasets)} datasets..."}) + "\n"
        
        for idx, ds_info in enumerate(req.datasets):
            yaml_path = Path(ds_info.path)
            base_dir = yaml_path.parent
            # Prefix to avoid identical names (e.g. "Basket_dataset_img1.jpg")
            prefix = ds_info.name.replace(" ", "_").replace("-", "_")
            
            # Search everywhere (train/val/test/images) ignoring the original split
            search_paths = [base_dir / 'train', base_dir / 'val', base_dir / 'test', base_dir / 'images', base_dir]
            seen_files = set()
            
            ds_count = 0
            for p in search_paths:
                if p.exists():
                    for f in p.rglob('*'):
                        # Filter only images
                        if f.is_file() and f.suffix.lower() in {'.jpg','.png','.jpeg','.webp'} and f.name not in seen_files:
                            seen_files.add(f.name)
                            
                            # Search for the corresponding label
                            lbl_f = None
                            try:
                                # YOLO Standard Strategy: Replace 'images' with 'labels' in path
                                parts = list(f.parts)
                                if 'images' in parts:
                                    i = len(parts) - 1 - parts[::-1].index('images')
                                    parts[i] = 'labels'
                                    pot = Path(*parts).with_suffix('.txt')
                                    if pot.exists(): lbl_f = pot
                            except: pass
                            
                            # Fallback strategy: label in the same folder as the image
                            if not lbl_f: 
                                pot = f.with_suffix('.txt')
                                if pot.exists(): lbl_f = pot
                            
                            new_name = f"{prefix}_{f.name}"
                            all_items.append({'img': f, 'lbl': lbl_f, 'ds_idx': idx, 'name': new_name})
                            ds_count += 1
            
            yield json.dumps({"type": "log", "msg": f"  - Found {ds_count} images in {ds_info.name}"}) + "\n"

        # 4. Shuffle e Resplit
        yield json.dumps({"type": "log", "msg": "🎲 Shuffling and Splitting..."}) + "\n"
        
        random.seed(req.seed)
        random.shuffle(all_items)
        
        total = len(all_items)
        n_train = int(total * req.split_ratios[0])
        n_val = int(total * req.split_ratios[1])
        # The rest goes to test
        
        splits = [
            ('train', all_items[:n_train]),
            ('val', all_items[n_train:n_train+n_val]),
            ('test', all_items[n_train+n_val:])
        ]
        
        processed_count = 0
        
        # 5. Physical Processing (Copy Files and Rewrite Labels)
        for split_name, items in splits:
            if not items: continue
            
            img_dest_dir, lbl_dest_dir = dirs[split_name]
            
            for item in items:
                # Copy image
                try:
                    shutil.copy2(item['img'], img_dest_dir / item['name'])
                except Exception as e:
                    print(f"Error copying {item['img']}: {e}")
                    continue
                
                # Elaborate Label
                if item['lbl'] and item['lbl'].exists():
                    new_lines = []
                    try:
                        with open(item['lbl'], 'r') as f:
                            for line in f:
                                parts = line.strip().split()
                                if len(parts) >= 5:
                                    try:
                                        src_cls = int(float(parts[0]))
                                        # Check the map: if it returns -1 it means "exclude"
                                        target_cls = map_lookup.get(item['ds_idx'], {}).get(src_cls, -1)
                                        
                                        if target_cls != -1:
                                            parts[0] = str(target_cls)
                                            new_lines.append(" ".join(parts))
                                    except: pass
                        
                        # Write the new txt file only if there are valid labels
                        if new_lines:
                            with open(lbl_dest_dir / Path(item['name']).with_suffix('.txt'), 'w') as f_out:
                                f_out.write("\n".join(new_lines))
                    except: pass
                
                processed_count += 1
                
                # Yield PROGRESS every 10 images (so as not to clog up the network)
                if processed_count % 10 == 0 or processed_count == total:
                    yield json.dumps({
                        "type": "progress",
                        "current": processed_count,
                        "total": total,
                        "percent": round((processed_count / total) * 100, 1),
                        "log": f"Processing {split_name}: {item['name']}"
                    }) + "\n"

        # 6. Final data.yaml generation
        yaml_content = {
            'path': str(output_dir),
            'train': 'images/train',
            'val': 'images/val',
            'test': 'images/test',
            'names': {i: name for i, name in enumerate(req.target_classes)}
        }
        
        with open(output_dir / 'data.yaml', 'w') as f:
            yaml.dump(yaml_content, f, sort_keys=False)
            
        yield json.dumps({
            "type": "complete",
            "data": {
                "output_path": str(output_dir),
                "total_processed": processed_count,
                "classes": req.target_classes
            }
        }) + "\n"