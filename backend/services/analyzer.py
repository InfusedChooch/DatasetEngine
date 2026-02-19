import yaml
import hashlib
import json
from pathlib import Path
from collections import Counter
from models.schemas import DatasetStats, SplitStat
import os
import shutil
import random
import concurrent.futures

class AnalyzerService:
    
    @staticmethod
    def get_quick_hash(path: Path) -> str:
        try:
            size = path.stat().st_size
            if size < 65536:
                with open(path, "rb") as f:
                    return hashlib.md5(f.read()).hexdigest()
            h = hashlib.md5()
            with open(path, "rb") as f:
                h.update(f.read(4096))
                f.seek(size // 2)
                h.update(f.read(4096))
                f.seek(-4096, 2)
                h.update(f.read(4096))
            h.update(str(size).encode())
            return h.hexdigest()
        except Exception:
            return ""

    @staticmethod
    def analyze_dataset_generator(yaml_path_str: str, dataset_id: str, split: str = "all"):
        """
        GENERATOR: Performs analysis and sends real-time updates (Streaming NDJSON).
        Now reads EVERYTHING initially so the frontend can switch tabs instantly.
        """
        yield json.dumps({"type": "log", "msg": f"🚀 Starting Global Deep Analysis..."}) + "\n"
        
        yaml_path = Path(yaml_path_str)
        if not yaml_path.exists():
            yield json.dumps({"type": "error", "msg": f"File not found: {yaml_path}"}) + "\n"
            return

        with open(yaml_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        yield json.dumps({"type": "log", "msg": "📄 Configuration loaded. Resolving paths..."}) + "\n"
        
        # --- PATH RESOLUTION WITH SPLIT FILTERING ---
        root_path = yaml_path.parent
        if 'path' in config:
            config_path = Path(config['path'])
            attempted_path = config_path if config_path.is_absolute() else (root_path / config_path).resolve()
            
            if attempted_path.exists() and attempted_path.is_dir():
                root_path = attempted_path
            else:
                yield json.dumps({"type": "log", "msg": "⚠️ Ignored broken path in YAML. Using local directory..."}) + "\n"

        # WE FORCE READING EVERYTHING
        search_dirs = ['train', 'val', 'valid', 'test']

        yield json.dumps({"type": "log", "msg": f"📂 Target Directories: {', '.join(search_dirs)}"}) + "\n"

        # --- GATHER IMAGES ---
        image_files = []
        extensions = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
        
        for d in search_dirs:
            p = root_path / d
            if not p.exists(): p = root_path / 'images' / d
            if p.exists() and p.is_dir():
                image_files.extend([f for f in p.rglob('*') if f.suffix.lower() in extensions])
                
        image_files = list(set(image_files)) # Removes any duplicates
        
        total_images = len(image_files)
        yield json.dumps({"type": "log", "msg": f"📸 Found {total_images} images. Starting inspection..."}) + "\n"

        # --- CLASSES ---
        classes = config.get('names', {})
        if isinstance(classes, list):
            classes = {i: name for i, name in enumerate(classes)}
        elif isinstance(classes, dict):
            classes = {int(k): v for k, v in classes.items()}

        # Advanced data structures for separate tracking
        temp_stats = {s: {'img': 0, 'lbl': 0, 'c_dist': Counter(), 'i_dist': Counter()} for s in ['train', 'val', 'test', 'all']}
        
        duplicate_labels_count = Counter()
        background_images = 0
        box_sizes = Counter({'Small': 0, 'Medium': 0, 'Large': 0})
        duplicate_images_count = 0
        duplicate_groups = []

        # 1. Image Duplicates (Smart Hash)
        files_by_size = {}
        
        # Phase 1: Hashing
        for i, img in enumerate(image_files):
            # --- UNDERSTAND WHICH FOLDER WE ARE IN ---
            img_parts = [p.lower() for p in img.parts]
            img_split = 'train' # default
            if 'val' in img_parts or 'valid' in img_parts: img_split = 'val'
            elif 'test' in img_parts: img_split = 'test'
            
            temp_stats[img_split]['img'] += 1
            temp_stats['all']['img'] += 1
            # -----------------------------------
            
            # Resolve Label Path
            label_file = None
            try:
                sz = img.stat().st_size
                if sz not in files_by_size: files_by_size[sz] = []
                files_by_size[sz].append(img)
            except: pass
            
            # Update progress every 50 images
            if i % 50 == 0:
                yield json.dumps({
                    "type": "progress",
                    "current": i,
                    "total": total_images * 2,
                    "percent": round((i / (total_images * 2)) * 100, 1),
                    "log": f"Indexing: {img.name}"
                }) + "\n"

        potential_duplicates = [files for files in files_by_size.values() if len(files) > 1]
        
        if potential_duplicates:
            yield json.dumps({"type": "log", "msg": f"🕵️ Checking {len(potential_duplicates)} suspicious groups..."}) + "\n"
            for group in potential_duplicates:
                group_hashes = {} 
                for f in group:
                    h = AnalyzerService.get_quick_hash(f)
                    if h not in group_hashes: group_hashes[h] = []
                    group_hashes[h].append(str(f))
                
                for h, paths in group_hashes.items():
                    if len(paths) > 1:
                        duplicate_images_count += (len(paths) - 1)
                        duplicate_groups.append(paths)

        # Phase 2: Labels
        yield json.dumps({"type": "log", "msg": "📝 Analyzing annotations..."}) + "\n"
        processed_base = total_images 
        
        for i, img_file in enumerate(image_files):
            # --- UNDERSTAND WHICH FOLDER WE ARE IN ---
            img_parts = [p.lower() for p in img_file.parts]
            img_split = 'train' # default
            if 'val' in img_parts or 'valid' in img_parts: img_split = 'val'
            elif 'test' in img_parts: img_split = 'test'
            
            # Resolve Label Path
            label_file = None
            potential = img_file.with_suffix('.txt')
            if potential.exists(): label_file = potential
            else:
                try:
                    parts = list(img_file.parts)
                    if 'images' in parts:
                        idx = len(parts) - 1 - parts[::-1].index('images')
                        parts[idx] = 'labels'
                        potential = Path(*parts).with_suffix('.txt')
                        if potential.exists(): label_file = potential
                except: pass
            
            if not label_file:
                 potential = img_file.parent.parent / 'labels' / img_file.name
                 potential = potential.with_suffix('.txt')
                 if potential.exists(): label_file = potential

            if label_file:
                try:
                    with open(label_file, 'r') as f:
                        content = f.read()
                        if not content.strip():
                            background_images += 1
                        else:
                            lines = content.splitlines()
                            seen_lines = set()
                            has_valid = False
                            seen_classes_in_this_img = set() 
                            
                            for line in lines:
                                line = line.strip()
                                if not line: continue
                                
                                # Check Duplicate Labels
                                if line in seen_lines:
                                    try:
                                        c_id = int(float(line.split()[0]))
                                        c_name = classes.get(c_id, str(c_id))
                                        duplicate_labels_count[c_name] += 1
                                    except: pass
                                    continue
                                
                                seen_lines.add(line)
                                parts = line.split()
                                if len(parts) >= 5:
                                    try:
                                        class_id = int(float(parts[0]))
                                        w = float(parts[3])
                                        h = float(parts[4])
                                        
                                        # Split and Global Update
                                        temp_stats[img_split]['c_dist'][class_id] += 1
                                        temp_stats['all']['c_dist'][class_id] += 1
                                        temp_stats[img_split]['lbl'] += 1
                                        temp_stats['all']['lbl'] += 1
                                        
                                        seen_classes_in_this_img.add(class_id) 
                                        has_valid = True
                                        
                                        area = w * h
                                        if area < 0.003: box_sizes['Small'] += 1
                                        elif area < 0.03: box_sizes['Medium'] += 1
                                        else: box_sizes['Large'] += 1
                                    except ValueError: continue
                            
                            for c_id in seen_classes_in_this_img:
                                temp_stats[img_split]['i_dist'][c_id] += 1
                                temp_stats['all']['i_dist'][c_id] += 1
                                
                            if not has_valid: background_images += 1
                except Exception:
                    background_images += 1
            else:
                background_images += 1
            
            # Progress Update
            if i % 20 == 0:
                current_total = i + processed_base
                yield json.dumps({
                    "type": "progress",
                    "current": current_total,
                    "total": total_images * 2,
                    "percent": round((current_total / (total_images * 2)) * 100, 1),
                    "log": f"Reading labels for {img_file.name}"
                }) + "\n"

        # Construction of the SplitStat mega-object
        final_split_stats = {}
        for s in ['train', 'val', 'test', 'all']:
            final_split_stats[s] = SplitStat(
                total_images=temp_stats[s]['img'],
                total_labels=temp_stats[s]['lbl'],
                class_distribution={classes.get(cid, str(cid)): count for cid, count in temp_stats[s]['c_dist'].items()},
                image_distribution={classes.get(cid, str(cid)): count for cid, count in temp_stats[s]['i_dist'].items()}
            )

        avg_labels = temp_stats['all']['lbl'] / total_images if total_images > 0 else 0

        final_stats = DatasetStats(
            dataset_id=dataset_id,
            name=yaml_path.stem,
            total_images=total_images,
            total_labels=temp_stats['all']['lbl'],
            classes=classes,
            class_distribution=final_split_stats['all'].class_distribution,
            image_distribution=final_split_stats['all'].image_distribution,
            split_stats=final_split_stats, # <--- IL FRONTEND USERA' QUESTO
            image_paths=[str(p) for p in image_files[:20]],
            path=str(yaml_path),
            avg_labels_per_image=round(avg_labels, 2),
            background_images=background_images,
            box_size_distribution=dict(box_sizes),
            duplicate_images=duplicate_images_count,
            duplicate_labels=dict(duplicate_labels_count),
            duplicate_groups=duplicate_groups
        )

        yield json.dumps({
            "type": "complete",
            "data": final_stats.dict()
        }) + "\n"

    @staticmethod
    def cleanup_dataset(request) -> dict:
        deleted_images = 0
        fixed_labels = 0
        
        # 1. DUPLICATE IMAGE REMOVAL (Keeps first, deletes copies)
        if request.clean_images and request.duplicate_groups:
            for group in request.duplicate_groups:
                if len(group) > 1:
                    for img_path_str in group[1:]:
                        try:
                            img_path = Path(img_path_str)
                            if img_path.exists():
                                img_path.unlink()
                                deleted_images += 1
                                
                                lbl_file = None
                                parts = list(img_path.parts)
                                if 'images' in parts:
                                    idx = len(parts) - 1 - parts[::-1].index('images')
                                    parts[idx] = 'labels'
                                    lbl_file = Path(*parts).with_suffix('.txt')
                                else:
                                    lbl_file = img_path.with_suffix('.txt')
                                    
                                if lbl_file and lbl_file.exists():
                                    lbl_file.unlink()
                        except Exception:
                            pass
                            
        # 2. REMOVING DUPLICATE LABEL (TURBO MULTI-THREADING)
        if request.clean_labels:
            yaml_path = Path(request.dataset_path)
            if yaml_path.exists():
                dataset_dir = yaml_path.parent
                
                txt_files = []
                for sub in ['train', 'val', 'valid', 'test', 'labels', 'images']:
                    target = dataset_dir / sub
                    if target.exists():
                        txt_files.extend(target.rglob("*.txt"))
                        
                txt_files = list(set(txt_files))
                
                def process_txt(txt_file):
                    local_fixes = 0
                    if txt_file.name.lower() in ["classes.txt", "readme.txt", "readme.dataset.txt", "readme.roboflow.txt"]:
                        return 0
                    try:
                        with open(txt_file, 'r', encoding='utf-8') as f:
                            lines = f.read().splitlines()
                            
                        seen = set()
                        unique_lines = []
                        modified = False
                        
                        for line in lines:
                            val = line.strip()
                            if not val: continue
                            if val in seen:
                                local_fixes += 1
                                modified = True
                            else:
                                seen.add(val)
                                unique_lines.append(val)
                                
                        if modified:
                            with open(txt_file, 'w', encoding='utf-8') as f:
                                f.write('\n'.join(unique_lines) + '\n')
                    except Exception:
                        pass
                    return local_fixes

                with concurrent.futures.ThreadPoolExecutor() as executor:
                    results = executor.map(process_txt, txt_files)
                    fixed_labels = sum(results)
                        
        return {"deleted_images": deleted_images, "fixed_labels": fixed_labels}
    
    @staticmethod
    def resplit_dataset_generator(request):
        yaml_path = Path(request.dataset_path)
        root_path = yaml_path.parent
        
        if not getattr(request, 'output_folder', None):
            target_root = root_path / "Resplit_Dataset"
        else:
            target_root = Path(request.output_folder)
        
        is_preview = getattr(request, 'is_preview', False)
        
        yield json.dumps({"type": "log", "msg": f"🚀 Preparing {'Preview' if is_preview else 'Dataset Copy'}..."}) + "\n"
        
        with open(yaml_path, 'r', encoding='utf-8') as f: 
            config = yaml.safe_load(f)
            
        classes = config.get('names', {})
        if isinstance(classes, list): classes = {i: name for i, name in enumerate(classes)}
        elif isinstance(classes, dict): classes = {int(k): v for k, v in classes.items()}

        all_images = []
        for sub in ['train', 'val', 'valid', 'test']:
            for img_dir in [root_path / sub, root_path / 'images' / sub]:
                if img_dir.exists():
                    all_images.extend([p for p in img_dir.rglob('*') if p.suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}])
        all_images = list(set(all_images))
        
        yield json.dumps({"type": "log", "msg": f"🔍 Analyzing {len(all_images)} labels for Stratification..."}) + "\n"
        image_data = []
        for i, img_path in enumerate(all_images):
            lbl_path = None
            parts = list(img_path.parts)
            if 'images' in parts:
                idx = len(parts) - 1 - parts[::-1].index('images')
                parts[idx] = 'labels'
                lbl_path = Path(*parts).with_suffix('.txt')
            else: lbl_path = img_path.with_suffix('.txt')
                
            classes_in_img = set()
            labels_in_img = Counter()
            if lbl_path and lbl_path.exists():
                try:
                    with open(lbl_path, 'r') as f:
                        for line in f:
                            if line.strip(): 
                                cid = int(float(line.split()[0]))
                                classes_in_img.add(cid)
                                labels_in_img[cid] += 1
                except: pass
                
            image_data.append({'img': img_path, 'lbl': lbl_path if lbl_path and lbl_path.exists() else None, 'classes': list(classes_in_img), 'labels_count': labels_in_img})
            if i % 200 == 0:
                yield json.dumps({"type": "progress", "current": i, "total": len(all_images), "percent": round(i/len(all_images)*30, 1)}) + "\n"

        yield json.dumps({"type": "log", "msg": "⚖️ Calculating Optimal Stratification..."}) + "\n"
        random.seed(42)
        random.shuffle(image_data)
        
        targets = {'train': request.train_pct / 100.0, 'val': request.val_pct / 100.0, 'test': request.test_pct / 100.0}
        splits = {'train': [], 'val': [], 'test': []}
        class_counts = {'train': Counter(), 'val': Counter(), 'test': Counter()}
        
        priority_classes = getattr(request, 'priority_classes', [])
        priority_ids = [k for k, v in classes.items() if v in priority_classes]

        for item in image_data:
            scores = {'train': 0, 'val': 0, 'test': 0}
            for s in ['train', 'val', 'test']:
                total_assigned = max(1, len(splits['train']) + len(splits['val']) + len(splits['test']))
                current_ratio = len(splits[s]) / total_assigned
                score = targets[s] - current_ratio 
                for c in item['classes']:
                    total_c = max(1, class_counts['train'][c] + class_counts['val'][c] + class_counts['test'][c])
                    c_ratio = class_counts[s][c] / total_c
                    weight = 5.0 if c in priority_ids else 1.0
                    score += (targets[s] - c_ratio) * weight
                scores[s] = score
            best_split = max(scores, key=scores.get)
            splits[best_split].append(item)
            for c in item['classes']: class_counts[best_split][c] += item['labels_count'][c]
                
        if is_preview:
            preview_stats = {}
            global_class_counts = Counter()
            for s in ['train', 'val', 'test']:
                for c, count in class_counts[s].items(): global_class_counts[c] += count
            for s in ['train', 'val', 'test']:
                lbl_dist = {classes.get(cid, str(cid)): count for cid, count in class_counts[s].items()}
                preview_stats[s] = {"images": len(splits[s]), "total_labels": sum(class_counts[s].values()), "labels_distribution": lbl_dist, "target_pct": targets[s] * 100}
            yield json.dumps({"type": "preview_result", "data": preview_stats, "global_totals": {classes.get(cid, str(cid)): count for cid, count in global_class_counts.items()}}) + "\n"
            return

        yield json.dumps({"type": "log", "msg": f"🚚 Copying files to: {target_root}..."}) + "\n"
        for s in ['train', 'val', 'test']:
            (target_root / 'images' / s).mkdir(parents=True, exist_ok=True)
            (target_root / 'labels' / s).mkdir(parents=True, exist_ok=True)
            
        processed, total_files = 0, len(image_data)
        for s, items in splits.items():
            for item in items:
                img_dest = target_root / 'images' / s / item['img'].name
                try: shutil.copy2(str(item['img']), str(img_dest))
                except: pass
                
                if item['lbl'] and item['lbl'].exists():
                    lbl_dest = target_root / 'labels' / s / item['lbl'].name
                    try: shutil.copy2(str(item['lbl']), str(lbl_dest))
                    except: pass
                
                processed += 1
                if processed % 100 == 0:
                    yield json.dumps({"type": "progress", "current": processed, "total": total_files, "percent": 30 + round(processed/total_files*65, 1)}) + "\n"

        yield json.dumps({"type": "log", "msg": "📝 Generating new data.yaml..."}) + "\n"
        new_config = config.copy()
        new_config['path'] = str(target_root.absolute())
        new_config['train'] = "images/train"
        new_config['val'] = "images/val"
        new_config['test'] = "images/test"
        
        with open(target_root / 'data.yaml', 'w', encoding='utf-8') as f:
            yaml.dump(new_config, f, sort_keys=False)

        yield json.dumps({"type": "complete", "data": f"Dataset copied and re-split successfully in {target_root}"}) + "\n"