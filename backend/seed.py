"""
seed.py — Наповнення БД тестовими даними
=========================================
Запускай так: python seed.py

Скрипт:
1. Видаляє всі існуючі таблиці (якщо є)
2. Створює таблиці заново
3. Вставляє тестові дані (предмети, тести, питання)

Дані взяті з data.js фронтенду — це та сама математика.
ПЛЮС додані заглушки для платних тестів (is_premium=True).
"""

from database import Base, SessionLocal, engine
import models


def seed():
    print("🗑  Очищення БД...")
    Base.metadata.drop_all(bind=engine)

    print("🏗  Створення таблиць...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()

    try:
        # ============================================
        # ПРЕДМЕТИ
        # ============================================
        print("📚 Додавання предметів...")

        math = models.Subject(name="Математика",    slug="math",    icon="📐")
        ukr  = models.Subject(name="Укр. мова",     slug="ukrainian", icon="📖")
        hist = models.Subject(name="Історія",        slug="history", icon="🏛")

        db.add_all([math, ukr, hist])
        db.flush()  # flush дає нам id без commit

        # ============================================
        # ТЕСТИ — МАТЕМАТИКА (безкоштовний)
        # ============================================
        print("📝 Додавання тесту з математики...")

        math_test = models.Test(
            subject_id=math.id,
            title="Пробний НМТ — Математика (Beta)",
            description="Базовий пробний тест з алгебри та геометрії. 5 питань.",
            duration=600,           # 10 хвилин для демо
            is_premium=False,       # ← БЕЗКОШТОВНИЙ
            is_published=True,
            order_index=1,
            reference_materials="""
                <h3>📐 Геометрія</h3>
                <p><strong>S = πr²</strong> — Площа кола</p>
                <p><strong>C = 2πr</strong> — Довжина кола</p>
                <p><strong>a² + b² = c²</strong> — Теорема Піфагора</p>
                <hr>
                <h3>📊 Алгебра</h3>
                <p><strong>D = b² − 4ac</strong> — Дискримінант</p>
                <p><strong>x = (−b ± √D) / 2a</strong> — Корені рівняння</p>
            """
        )
        db.add(math_test)
        db.flush()

        # Питання та варіанти відповідей
        _add_question(db, math_test.id, order=1,
            text="Знайдіть значення виразу: <strong>2³ + 4² − √25</strong>",
            options=["19", "21", "23", "17"],
            correct_index=0,  # Правильна: А (19) = 8+16-5
            explanation="2³=8, 4²=16, √25=5. Отже: 8+16−5 = 19"
        )

        _add_question(db, math_test.id, order=2,
            text="Розв'яжіть рівняння: <strong>x² − 5x + 6 = 0</strong>. Знайдіть більший корінь.",
            options=["x = 1", "x = 2", "x = 3", "x = 6"],
            correct_index=2,  # Правильна: В (x=3)
            explanation="D = 25−24 = 1. x₁ = (5+1)/2 = 3, x₂ = (5−1)/2 = 2. Більший: 3"
        )

        _add_question(db, math_test.id, order=3,
            text="Периметр квадрата дорівнює 28 см. Знайдіть площу цього квадрата.",
            options=["36 см²", "49 см²", "56 см²", "64 см²"],
            correct_index=1,  # Правильна: Б (49 см²)
            explanation="Сторона = 28÷4 = 7 см. Площа = 7² = 49 см²"
        )

        _add_question(db, math_test.id, order=4,
            text="Яке з чисел є розв'язком нерівності: <strong>3x − 7 > 2</strong>?",
            options=["x = 1", "x = 2", "x = 3", "x = 4"],
            correct_index=3,  # Правильна: Г (x=4)
            explanation="3x > 9, тобто x > 3. З варіантів тільки x=4 задовольняє умову."
        )

        _add_question(db, math_test.id, order=5,
            text="У прямокутному трикутнику один катет 6 см, гіпотенуза 10 см. Знайдіть другий катет.",
            options=["4 см", "6 см", "8 см", "√136 см"],
            correct_index=2,  # Правильна: В (8 см)
            explanation="За теоремою Піфагора: b² = 10²−6² = 100−36 = 64. b = 8 см"
        )

        # ============================================
        # ТЕСТИ — ЗАГЛУШКИ ПЛАТНИХ ТЕСТІВ (для бети)
        # ============================================
        print("🔒 Додавання платних тестів-заглушок...")

        # Другий тест математики (premium)
        db.add(models.Test(
            subject_id=math.id,
            title="НМТ Математика — Варіант 2",
            description="Поглиблений тест. Тригонометрія, логарифми, стереометрія.",
            duration=10800,
            is_premium=True,    # ← ПЛАТНИЙ
            is_published=True,
            order_index=2
        ))

        # Тести укр. мови
        db.add(models.Test(
            subject_id=ukr.id,
            title="Пробний НМТ — Укр. мова (Beta)",
            description="Орфографія, пунктуація, текст для читання.",
            duration=600,
            is_premium=False,   # ← БЕЗКОШТОВНИЙ
            is_published=True,
            order_index=1
        ))

        db.add(models.Test(
            subject_id=ukr.id,
            title="НМТ Укр. мова — Варіант 2",
            description="",
            duration=10800,
            is_premium=True,
            is_published=True,
            order_index=2
        ))

        # Тест з історії
        db.add(models.Test(
            subject_id=hist.id,
            title="Пробний НМТ — Історія України (Beta)",
            description="Козацька доба, національно-визвольний рух, новітня історія.",
            duration=600,
            is_premium=False,
            is_published=True,
            order_index=1
        ))

        db.commit()
        print("\n✅ Готово! БД наповнена тестовими даними.")
        print("   Запусти сервер: uvicorn main:app --reload")

    except Exception as e:
        db.rollback()
        print(f"\n❌ Помилка: {e}")
        raise
    finally:
        db.close()


def _add_question(db, test_id, order, text, options, correct_index, explanation=""):
    """
    Допоміжна функція: додає питання з варіантами відповідей.
    Через циклічний FK (Question ↔ AnswerOption) потрібні два flush.
    """
    letters = ["А", "Б", "В", "Г"]

    # Крок 1: Створюємо питання без correct_answer_id
    question = models.Question(
        test_id=test_id,
        type=models.QuestionType.single,
        text=text,
        order_index=order,
        explanation=explanation,
        points=1.0
    )
    db.add(question)
    db.flush()  # Отримуємо question.id

    # Крок 2: Створюємо варіанти відповідей
    option_objects = []
    for i, opt_text in enumerate(options):
        opt = models.AnswerOption(
            question_id=question.id,
            text=opt_text,
            order_index=i
        )
        db.add(opt)
        option_objects.append(opt)

    db.flush()  # Отримуємо id для кожного варіанту

    # Крок 3: Встановлюємо правильну відповідь
    question.correct_answer_id = option_objects[correct_index].id
    db.flush()


if __name__ == "__main__":
    seed()
