import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useArticleStore } from '@/stores/articleStore'
import { Card, CardContent } from '@/components/ui/card'
import { BookOpen } from 'lucide-react'

export default function ArticleListPage() {
  const navigate = useNavigate()
  const { categories, articles, currentCategory, allProgress, loading, loadCategories, loadArticles, loadAllProgress } = useArticleStore()

  useEffect(() => { loadCategories() }, [])

  useEffect(() => {
    if (categories.length > 0 && !currentCategory) {
      loadArticles(categories[0].enName).then(() => loadAllProgress())
    }
  }, [categories, currentCategory, loadArticles, loadAllProgress])

  const handleCategoryClick = (enName: string) => {
    loadArticles(enName).then(() => loadAllProgress())
  }

  const handleArticleClick = (id: number) => {
    navigate(`/articles/${id}`)
  }

  const getProgress = (articleId: number) => allProgress[`${articleId}_follow`]

  return (
    <div className="max-w-4xl mx-auto space-y-6 pt-4">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-5 w-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">文章打字</h2>
      </div>

      <div className="flex gap-2 flex-wrap">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.enName)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              currentCategory?.enName === cat.enName
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/70 text-foreground'
            }`}
          >
            {cat.name}
            <span className="ml-1.5 text-xs opacity-60">{cat.length}篇</span>
          </button>
        ))}
      </div>

      {currentCategory && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground mb-3">{currentCategory.description}</p>
        </div>
      )}

      {loading ? (
        <div className="text-center text-muted-foreground py-12">加载中...</div>
      ) : articles.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          {currentCategory ? '该分类暂无文章' : '选择一个分类开始练习'}
        </div>
      ) : (
        <div className="space-y-2">
          {articles.map((a, i) => {
            const progress = getProgress(a.id)
            return (
              <Card
                key={a.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleArticleClick(a.id)}
              >
                <CardContent className="p-4 flex items-center gap-4">
                  <span className="text-sm text-muted-foreground w-8 shrink-0">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">
                      {progress?.completed ? '✓ ' : ''}{a.title}
                    </h3>
                    {a.titleTranslate && (
                      <p className="text-sm text-muted-foreground truncate">{a.titleTranslate}</p>
                    )}
                  </div>
                  {progress?.completed && (
                    <div className="text-xs text-muted-foreground shrink-0 text-right">
                      <span className="text-green-600 dark:text-green-400">{Math.round(progress.bestAccuracy * 100)}%</span>
                      {' · '}
                      <span>{Math.round(progress.bestWpm)} WPM</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
