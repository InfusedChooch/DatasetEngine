# Crea backend/utils/dialogs.py
import tkinter as tk
from tkinter import filedialog
import os

def open_file_dialog():
    """Apre una finestra nativa di Windows per selezionare il file yaml"""
    # Nascondi la finestra principale di tkinter
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True) # Porta la finestra in primo piano
    
    file_path = filedialog.askopenfilename(
        title="Seleziona il file data.yaml",
        filetypes=[("YAML files", "*.yaml *.yml"), ("All files", "*.*")]
    )
    
    root.destroy()
    return file_path