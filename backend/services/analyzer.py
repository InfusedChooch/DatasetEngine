import yaml
from pathlib import Path
from collections import Counter
from models.schemas import DatasetStats
import os

class AnalyzerService:
    @staticmethod
    def analyze_dataset(yaml_path_str: str, dataset_id: str) -> DatasetStats:
        print(f"\n--- INIZIO ANALISI DATASET (v2) ---")
        yaml_path = Path(yaml_path_str)
        
        if not yaml_path.exists():
            raise FileNotFoundError(f"File non trovato: {yaml_path}")

        with open(yaml_path, 'r', encoding='utf-8') as f:
            config = yaml.safe_load(f)
        
        # 1. Determinare path base e train
        base_path = yaml_path.parent
        if 'path' in config:
            potential_path = Path(config['path'])
            if potential_path.exists():
                base_path = potential_path
        
        train_config = config.get('train')
        if not train_config:
            if (base_path / 'train').exists():
                train_path = base_path / 'train'
            elif (base_path / 'images' / 'train').exists():
                train_path = base_path / 'images' / 'train'
            else:
                raise ValueError("Cartella train non trovata")
        else:
            train_path = Path(train_config)
            if not train_path.is_absolute():
                train_path = (base_path / train_path).resolve()
        
        print(f"🔍 Cerco immagini in: {train_path}")

        # 2. Raccogliere immagini
        image_files = []
        if train_path.is_dir():
            extensions = ['*.jpg', '*.jpeg', '*.png', '*.bmp', '*.webp']
            for ext in extensions:
                image_files.extend(list(train_path.rglob(ext)))
        elif train_path.suffix == '.txt' and train_path.exists():
            with open(train_path, 'r') as f:
                for line in f:
                    p = Path(line.strip())
                    if not p.is_absolute():
                        p = (base_path / p).resolve()
                    if p.exists():
                        image_files.append(p)
        
        print(f"📸 Immagini: {len(image_files)}")

        # 3. Classi
        classes = config.get('names', {})
        if isinstance(classes, list):
            classes = {i: name for i, name in enumerate(classes)}
        elif isinstance(classes, dict):
            classes = {int(k): v for k, v in classes.items()}

        # 4. Analisi Approfondita Label
        class_counts = Counter()
        total_labels = 0
        background_images = 0
        
        # Definizioni COCO per dimensioni (basate su area relativa normalizzata)
        # Small: < 0.3% dell'area immagine
        # Medium: 0.3% - 3%
        # Large: > 3%
        box_sizes = Counter({'Small': 0, 'Medium': 0, 'Large': 0})
        
        for img_file in image_files:
            label_file = None
            parts = list(img_file.parts)
            has_labels = False
            
            # Logica ricerca label (la stessa che funzionava prima)
            if 'images' in parts:
                try:
                    idx = len(parts) - 1 - parts[::-1].index('images')
                    parts[idx] = 'labels'
                    potential = Path(*parts).with_suffix('.txt')
                    if potential.exists():
                        label_file = potential
                except ValueError: pass
            
            if not label_file:
                potential = img_file.with_suffix('.txt')
                if potential.exists(): label_file = potential

            if not label_file:
                 potential = img_file.parent.parent / 'labels' / img_file.name
                 potential = potential.with_suffix('.txt')
                 if potential.exists(): label_file = potential

            if label_file:
                try:
                    with open(label_file, 'r') as f:
                        lines = f.readlines()
                        if not lines:
                            background_images += 1
                            continue
                            
                        file_has_valid_labels = False
                        for line in lines:
                            parts_line = line.strip().split()
                            if len(parts_line) >= 5:
                                try:
                                    class_id = int(float(parts_line[0]))
                                    w = float(parts_line[3])
                                    h = float(parts_line[4])
                                    
                                    if class_id in classes:
                                        class_counts[class_id] += 1
                                        total_labels += 1
                                        file_has_valid_labels = True
                                        
                                        # Calcolo dimensione box (area)
                                        area = w * h
                                        if area < 0.003: # < 0.3%
                                            box_sizes['Small'] += 1
                                        elif area < 0.03: # < 3%
                                            box_sizes['Medium'] += 1
                                        else:
                                            box_sizes['Large'] += 1
                                except ValueError: continue
                        
                        if not file_has_valid_labels:
                            background_images += 1
                            
                except Exception:
                    background_images += 1 # Se errore lettura, conta come vuota per sicurezza
            else:
                background_images += 1 # Nessun file label trovato

        # Statistiche finali
        avg_labels = total_labels / len(image_files) if len(image_files) > 0 else 0
        
        class_dist = {
            classes.get(cid, f"class_{cid}"): count 
            for cid, count in class_counts.items()
        }
        
        print(f"📊 Stats: {total_labels} labels, {background_images} empty images")
        print(f"📐 Sizes: {dict(box_sizes)}")

        return DatasetStats(
            dataset_id=dataset_id,
            name=yaml_path.stem,
            total_images=len(image_files),
            total_labels=total_labels,
            classes=classes,
            class_distribution=class_dist,
            image_paths=[str(p) for p in image_files[:20]],
            path=str(yaml_path),
            avg_labels_per_image=round(avg_labels, 2),
            background_images=background_images,
            box_size_distribution=dict(box_sizes)
        )