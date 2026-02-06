import yaml
from pathlib import Path
from collections import Counter
from models.schemas import DatasetStats
import os
import hashlib

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
    def analyze_dataset(yaml_path_str: str, dataset_id: str) -> DatasetStats:
        print(f"\n--- ANALYZING FOR DUPLICATES INSPECTION ---")
        yaml_path = Path(yaml_path_str)
        if not yaml_path.exists(): raise FileNotFoundError(f"File not found: {yaml_path}")

        with open(yaml_path, 'r', encoding='utf-8') as f: config = yaml.safe_load(f)
        yaml_dir = yaml_path.parent
        
        # Path resolution standard
        train_config = config.get('train')
        root_path = yaml_dir 
        if 'path' in config:
            config_path = Path(config['path'])
            root_path = config_path if config_path.is_absolute() else (yaml_dir / config_path).resolve()

        if train_config:
            p_train = Path(train_config)
            train_path = p_train if p_train.is_absolute() else (root_path / p_train).resolve()
        else:
            train_path = root_path / 'train'

        if not train_path.exists():
            for alt in [yaml_dir/'train', yaml_dir/'images'/'train', yaml_dir.parent/'train']:
                if alt.exists(): train_path = alt; break
        
        # Gather Images
        image_files = []
        if train_path.is_dir():
            image_files = [p for p in train_path.rglob('*') if p.suffix.lower() in {'.jpg','.jpeg','.png','.bmp','.webp'}]
        
        # Classes
        classes = config.get('names', {})
        if isinstance(classes, list): classes = {i: n for i, n in enumerate(classes)}
        
        # --- LOGICA DUPLICATI IMMAGINI (Con salvataggio gruppi) ---
        files_by_size = {}
        for img in image_files:
            try:
                sz = img.stat().st_size
                if sz not in files_by_size: files_by_size[sz] = []
                files_by_size[sz].append(img)
            except: pass
        
        duplicate_groups_map = {} # hash -> list of paths
        duplicate_images_count = 0

        potential_duplicates = [files for files in files_by_size.values() if len(files) > 1]
        
        for group in potential_duplicates:
            for f in group:
                h = AnalyzerService.get_quick_hash(f)
                if not h: continue
                if h not in duplicate_groups_map: duplicate_groups_map[h] = []
                duplicate_groups_map[h].append(str(f))

        # Filtriamo solo quelli che hanno collisioni
        final_duplicate_groups = [paths for paths in duplicate_groups_map.values() if len(paths) > 1]
        duplicate_images_count = sum(len(g) - 1 for g in final_duplicate_groups)

        # --- LOGICA LABELS (Standard) ---
        class_counts = Counter()
        duplicate_labels_count = Counter()
        total_labels = 0
        background_images = 0
        box_sizes = Counter({'Small': 0, 'Medium': 0, 'Large': 0})
        
        for img_file in image_files:
            # Trova label
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
                        lines = [l.strip() for l in f.readlines() if l.strip()]
                        if not lines:
                            background_images += 1
                            continue
                        
                        seen_lines = set()
                        valid_file = False
                        for line in lines:
                            if line in seen_lines:
                                try:
                                    c_name = classes.get(int(float(line.split()[0])), "unknown")
                                    duplicate_labels_count[c_name] += 1
                                except: pass
                                continue
                            seen_lines.add(line)
                            
                            parts = line.split()
                            if len(parts) >= 5:
                                total_labels += 1
                                valid_file = True
                                class_counts[int(float(parts[0]))] += 1
                                area = float(parts[3]) * float(parts[4])
                                if area < 0.003: box_sizes['Small']+=1
                                elif area < 0.03: box_sizes['Medium']+=1
                                else: box_sizes['Large']+=1
                        
                        if not valid_file: background_images += 1
                except: background_images += 1
            else:
                background_images += 1

        return DatasetStats(
            dataset_id=dataset_id,
            name=yaml_path.stem,
            total_images=len(image_files),
            total_labels=total_labels,
            classes=classes,
            class_distribution={classes.get(k,str(k)):v for k,v in class_counts.items()},
            image_paths=[str(p) for p in image_files[:20]],
            path=str(yaml_path),
            avg_labels_per_image=round(total_labels/len(image_files), 2) if image_files else 0,
            background_images=background_images,
            box_size_distribution=dict(box_sizes),
            duplicate_images=duplicate_images_count,
            duplicate_labels=dict(duplicate_labels_count),
            duplicate_groups=final_duplicate_groups # <-- IMPORTANTE
        )

    @staticmethod
    def cleanup_dataset(request) -> dict:
        """
        Esegue la pulizia fisica dei file.
        """
        deleted_images = 0
        fixed_labels = 0
        errors = []

        # 1. Pulizia Immagini Duplicate
        if request.clean_images and request.duplicate_groups:
            print("🧹 Cleaning duplicate images...")
            for group in request.duplicate_groups:
                # Mantieni il primo, cancella gli altri
                to_delete = group[1:] 
                for file_path in to_delete:
                    try:
                        p = Path(file_path)
                        if p.exists():
                            p.unlink() # Cancella immagine
                            deleted_images += 1
                            
                            # Cancella anche la label associata se esiste
                            # (Per evitare di lasciare label orfane)
                            # Cerchiamo la label con la stessa logica (semplificata: stesso nome, estensione .txt)
                            # Se la struttura è complessa, potremmo mancarne qualcuna, ma è sicuro.
                            
                            # Opzione A: Label accanto
                            txt_p = p.with_suffix('.txt')
                            if txt_p.exists(): txt_p.unlink()
                            
                            # Opzione B: Cartella labels parallela
                            try:
                                parts = list(p.parts)
                                if 'images' in parts:
                                    idx = len(parts) - 1 - parts[::-1].index('images')
                                    parts[idx] = 'labels'
                                    txt_p_yolo = Path(*parts).with_suffix('.txt')
                                    if txt_p_yolo.exists(): txt_p_yolo.unlink()
                            except: pass

                    except Exception as e:
                        errors.append(f"Err deleting {file_path}: {str(e)}")

        # 2. Pulizia Label Duplicate (Intra-file)
        if request.clean_labels:
            print("🧹 Cleaning duplicate labels inside files...")
            # Riscansioniamo velocemente tutti i txt nella cartella dataset
            # Nota: Per semplicità e velocità, qui ci fidiamo che l'utente abbia appena fatto l'analisi
            # In un sistema perfetto, ripasseremmo tutti i file.
            # Qui implementiamo una logica ricorsiva sulla cartella root del dataset
            
            root = Path(request.dataset_path).parent
            # Cerca tutti i .txt
            txt_files = list(root.rglob('*.txt'))
            
            for txt in txt_files:
                try:
                    with open(txt, 'r') as f:
                        lines = [l.strip() for l in f.readlines() if l.strip()]
                    
                    unique_lines = []
                    seen = set()
                    changed = False
                    
                    for line in lines:
                        if line not in seen:
                            seen.add(line)
                            unique_lines.append(line)
                        else:
                            changed = True
                            fixed_labels += 1
                    
                    if changed:
                        with open(txt, 'w') as f:
                            f.write('\n'.join(unique_lines) + '\n')
                            
                except Exception: pass

        return {
            "deleted_images": deleted_images,
            "fixed_labels": fixed_labels,
            "errors": errors
        }